# CS3219 — Software Design and Architecture (AY2627 Sem 1)

## Friend on Campus (FoC)

**Friend on Campus (FoC)** is a peer-to-peer campus errand platform where
students can request items to be collected from stores or facilities on
campus, and other students can fulfil (and deliver) those requests. The
platform runs on a closed credit economy — credits cannot be bought,
withdrawn, or exchanged for money, and circulate only within the platform.

---

## Team Members

| Name | Role |
| ----- | ----- |
| Malcolm Chu  | Order service |
| Gabriel Kua | User service |
| Nathan Tay | Credit service |
| Kea Harvan | Supplier service |

---

## Repository Structure

This repository follows a **one-service-per-folder** structure: each
microservice (`user-service/`, `supplier-service/`, `order-service/`,
`credit-service/`) lives in its own top-level folder.

```text
.
├── user-service/
├── supplier-service/
├── order-service/
├── credit-service/
├── faq-service/        (N2H: customer relations, F28)
└── README.md
```

- Any **nice-to-have (N2H)** feature that warrants its own service should
  be added as an **additional folder** at the same level, following the
  same per-service structure.
- Files for agentic coding tools (e.g. agent configs, prompts, skills)
  may be added as needed, but must still **respect the
  one-service-per-folder skeleton** for core implementation.
- Shared code lives in `packages/` (`shared-middleware`: Keycloak token
  checks, RBAC, error format; `shared-events`: RabbitMQ event contracts and
  outbox publisher). `infra/keycloak/` holds the Keycloak realm config and
  `frontend/` the React web app.

---

## Run it locally

Only **Docker Desktop** is needed.

```bash
cp .env.example .env     # then fill in the change-me values (any random strings work locally)
docker compose up -d --build
```

| What | URL |
| ----- | ----- |
| Web app | http://localhost:5173 |
| Keycloak (login server) admin console | http://localhost:8080 (login: `KC_BOOTSTRAP_ADMIN_*` from `.env`) |
| Fake email inbox (verification / reset emails) | http://localhost:8025 |
| User Service API docs | http://localhost:3001/v1/docs |
| Supplier Service API docs | http://localhost:3002/v1/docs |
| RabbitMQ UI | http://localhost:15672 (login: `RABBITMQ_*` from `.env`) |

**Pinned versions.** All image tags are pinned (`postgres:16-alpine`, `keycloak:26.8.1`,
`rabbitmq:4-management-alpine`, `nginx:1.30.6-alpine`, `node:22.23.3-alpine`,
`mailpit:v1.31.3`) so every machine builds the same stack. Bump them on purpose, in their own
commit, and run the whole stack afterwards — do not switch a tag back to `latest`.

**Auth in one paragraph.** Keycloak is the OAuth 2.0 / OpenID Connect server:
it shows the login page, stores password hashes and sessions, and issues
signed access tokens that carry the user's roles (`user` or `admin`). Sign-up
goes through the User Service (`POST /v1/auth/register`) so the `@u.nus.edu`
rule and other checks run on the server. Every service verifies the token
itself and asks the User Service whether the session is still live and the
account not suspended. The realm (roles, clients, password policy, session
timeouts) is defined in `infra/keycloak/campuserrand-realm.json`; it is imported
only when the Keycloak database is empty, so after editing it run
`docker compose down -v` (wipes local data) and start again.

**First admins.** On the first start the User Service creates two admins from
`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_TEMP_PASSWORD` and
`BOOTSTRAP_ADMIN_2_EMAIL` / `BOOTSTRAP_ADMIN_2_TEMP_PASSWORD` (each must change the
password at first login), then never again. Further admins need two admins:
one requests on *Admin: users*, a different one confirms on *Admin: role changes*.
Do not change roles or delete users in the Keycloak console: the User Service
database would not see it.

**Tests** (need the stack running):

```bash
npm install
npm test
```

**Tokens for curl/Postman** (dev-only client, users must have a verified email):

```bash
curl -X POST http://localhost:8080/realms/campuserrand/protocol/openid-connect/token \
  -d grant_type=password -d client_id=campuserrand-test -d username=<user> -d password=<pass>
```

---

## Customer Relations (N2H, F28) — FAQ RAG service (`faq-service/`)

A RAG-based FAQ assistant (nice-to-have F28). A signed-in student asks a question in the web app
and gets an answer grounded in a hand-written FAQ corpus, with citations; anything the corpus
cannot answer can be escalated to the team as a support request.

**F28 mapping.**

- **F28.1 knowledge base** — `faq-service/corpus/faq.md` (28 hand-reviewed Q/A chunks) ingested
  into a Chroma vector database (automatically on faq-service startup; idempotent upsert).
- **F28.2 conversational assistance** — `POST /v1/faq/ask`: cosine top-k retrieval, strict
  "answer only from these passages, cite them" prompt. Below the similarity floor the bot refuses
  and suggests the nearest topics.
- **F28.3 support escalation** — login-gated server-side tickets
  (`POST /v1/faq/support-requests`; admin triage via `GET`). Escalation is user-decided: the
  "Raise a support request" form is always available, and a refusal only pre-fills it. Admins
  move a ticket `open → under review → resolved` (`PATCH`, admin-only) and see an append-only
  history of every transition on the "Admin: FAQ tickets" page.

**Architecture.** Express 5 + `@foc/shared-middleware` (the house pattern). Two stores: **Chroma**
for the knowledge-base vectors, **Postgres (`faq_db`)** for the tickets — transactional records
with an insert-only status history, so they live in SQL rather than in a vector database.
Embeddings: `gemini-embedding-001` via the Gemini API. Generation: OpenRouter chat client. In the
UI: a dedicated `/faq` page (browse the KB, ask, raise a ticket) and a floating chat widget on
every signed-in page.

**Observability.** Every ask writes one structured pino line (`faq ask`) with the refusal flag,
top-1 similarity and duration. CloudWatch log metric filters turn those into the `FOC/FaqAsks`,
`FOC/FaqRefusals` and `FOC/FaqAskDurationMs` metrics on the shared `foc` dashboard, so RAG answer
quality sits next to the DLQ and outbox signals. Signals only, no alerting.

**Why not Bedrock?** The NUS AWS organisation SCP denies `bedrock:InvokeModel` account-wide
(verified live 5 Nov), so the model layer is provider-agnostic by design: embeddings and
generation are each one module (`faq-service/src/modelClient.ts`) and the store sits behind the
`FaqStore` interface (`faq-service/src/chroma.ts`) — swapping to Bedrock, pgvector (the
lower-infra fallback) or another vector DB is a one-module change plus a re-ingest.

**Keys.** `GEMINI_API_KEY` / `OPENROUTER_API_KEY` in `.env` locally (gitignored; see
`.env.example`), `/foc/faq-service/*` in SSM in prod (via `infra/terraform/scripts/put-secrets.ps1`).

See `faq-service/README.md` for endpoints, ingestion and the escalation design.

---

## AI Use Summary

**Tools:** Claude Code (VS Code extension), model `claude-opus-5-5`.

**Used for:**
- **Generating code:** service code across the project, such as APIs, database migrations, event
  handlers, background jobs, tests, Dockerfiles, seed data, frontend pages, and infrastructure
  config (Docker Compose, the nginx gateway, Terraform).
- **Refactoring:** restructuring code and build setup, such as the npm workspaces and Dockerfiles.
- **Debugging:** build and deploy errors, checking that service contracts and events match, and
  code reviews for bugs.
- **Explaining:** how existing code, config and tools work.

**Requirements and design:**
- AI was not used for requirements elicitation.
- Each service's requirements, tech stack and main design came from the team member who owns it.
  AI was given these as written briefs to implement.
- Where AI proposed details or alternatives (for example schema columns, retry and dead-letter
  handling, or how one service calls another), the service owner reviewed them and made the final
  decision.

**Verification:** AI-written code was reviewed by the service owner and checked with the test
suites, typechecks and `docker compose` builds before merging.

**Prompts and key exchanges:** see the per-member logs in [`ai/`](ai/). Each team member adds
their own prompts there.
