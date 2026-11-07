# FAQ Service (FoC customer relations — F28)

RAG-based FAQ chatbot. Signed-in students ask questions in natural language and get answers
grounded in the curated FAQ corpus, with citations. Questions the corpus cannot answer get a
refusal with the nearest topics and an escalation payload (F28.3).

- **F28.1** knowledge base: `corpus/faq.md` (primary, hand-written) — one chunk per `## heading`.
- **F28.2** conversational assistance: `POST /v1/faq/ask` — retrieve top-k from Chroma, generate
  with a strict "answer only from these passages, cite them" prompt.
- **F28.3** support escalation: login-gated server-side tickets. `POST /v1/faq/support-requests`
  stamps the userId from the verified token (never the body); `replyTo` is pre-filled in the UI
  from the token's verified email claim and is a reply-to convenience only. Admins triage via
  `GET /v1/faq/support-requests` (admin-only) and reach the user at their registered email.

## Stack

Express 5 + `@foc/shared-middleware` (auth, error envelope, logging) — same as user/credit/order
services. LangChain.js components (`@langchain/core` `VectorStore`, `@langchain/google-genai`
embeddings, `@langchain/openai` chat client) over hand-written retrieval/prompt logic.

Two stores, each doing what it is good at:

- **Chroma** — the vector store, for the knowledge base only (`foc_faq` collection).
- **Postgres (`faq_db`)** — the support tickets, which are transactional records, not vectors.
  `src/sqlTickets.ts` holds them; `migrations/` is applied at start by the shared
  `runMigrations`. Same house pattern as user/credit/order (pg Pool, one migration dir).

| Piece | Choice | Why |
| --- | --- | --- |
| Vector store | Chroma (`chromadb/chroma:1.5.9`) | dedicated vector DB; HNSW cosine; user decision |
| Embeddings | `gemini-embedding-001` (config `FAQ_EMBED_MODEL`) | top-3 MTEB eng-v2, best managed model |
| Generation | OpenRouter chat client (`FAQ_GEN_MODEL`, default `google/gemini-2.5-flash`) | model swapped by config for experiments |

Bedrock was the first choice but the NUS AWS organisation SCP denies `bedrock:InvokeModel`
account-wide (verified 5 Nov). The model layer is provider-agnostic by design: embeddings and
generation are each one module (`src/modelClient.ts`), and the store is behind `FaqStore`
(`src/chroma.ts`) — swapping to pgvector (the lower-infra fallback), Qdrant or Bedrock is one
module change plus a re-ingest.

## Environment

| Key | Purpose |
| --- | --- |
| `CHROMA_URL` | Chroma server URL (compose sets `http://chroma:8000`) |
| `GEMINI_API_KEY` | Google AI Studio key for embeddings |
| `OPENROUTER_API_KEY` | OpenRouter key for generation |
| `FAQ_EMBED_MODEL` / `FAQ_GEN_MODEL` | model ids (swap + re-ingest) |
| `FAQ_TOP_K`, `FAQ_SIMILARITY_FLOOR` | retrieval tuning (default 4 / 0.35 cosine similarity) |
| `FAQ_SUPPORT_EMAIL` | support address for the F28.3 escalation |
| `FAQ_DATABASE_URL` | Postgres for the ticket tables (`faq_db`) |

## Escalation design (F28.3)

Escalation is **user-decided, not bot-decided**: any signed-in user can raise a support request at
any time — a refusal only pre-fills the form (question + matched topics), it does not gate the
flow. The UI has two entrances:

- **`/faq` page** (nav item, login-gated): browses the knowledge base (`GET /v1/faq/entries`, so
  the list can never drift from what the bot cites), an ask panel, and an always-visible
  "Raise a support request" section.
- **Floating chat widget** (bottom-right on every signed-in page): same ask + raise flow in a
  popup; a refusal pre-fills the ticket form.

The earlier mailto design (prefilled `mailto:` link) was replaced by server-side tickets. An
admin replies through the user's registered email (Admin Users page); server-side SES remains the
documented production path for automated outbound mail.

## Endpoints

All require a bearer token (`requireAuth`, Keycloak) and use the shared error envelope.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/faq/ask` | grounded answer with citations, or a refusal with suggestions + escalation data |
| `GET /v1/faq/search?q=` | raw retrieval (no LLM call) |
| `GET /v1/faq/entries` | the full knowledge base, for the FAQ page's browse list |
| `POST /v1/faq/support-requests` | create a support ticket (userId from the token) |
| `GET /v1/faq/support-requests` | admin-only triage list (all statuses, newest first, with history) |
| `PATCH /v1/faq/support-requests/:id` | admin-only status transition (`under_review` or `resolved`) |

## Ticket lifecycle

`open → under review → resolved`, plus the direct `open → resolved` shortcut. A resolved ticket is
terminal. Transitions are **admin-only** and there is **no delete** — a support request is a record
that a student had a problem.

Every transition **appends** a row to `ticket_status_history` in the same transaction as the
status update; the `tickets.status` column is a cache of the latest history row for cheap
filtering, and the history is the source of truth. The app never updates or deletes history, so
the trail can be replayed: `open → under review by admin-1 → resolved by admin-2`.

Illegal transitions answer `409 INVALID_TRANSITION`, unknown tickets `404`.

## Observability (F28 logging)

Every ask emits one structured pino line, `msg: "faq ask"`, carrying `refused`,
`top1Similarity`, `similarityFloor`, `durationMs`, the retrieved headings and the model ids.
`infra/terraform/demo/observability.tf` turns those lines into the `FOC/FaqAsks`,
`FOC/FaqRefusals` and `FOC/FaqAskDurationMs` CloudWatch metrics, shown on the `foc` dashboard.

The **refusal rate is the RAG health signal**: if it climbs, either the corpus stopped covering
what students ask or `FAQ_SIMILARITY_FLOOR` is mis-tuned. There is deliberately no alerting —
signals only (user decision, 7 Nov).

Rejected for now, and why: **MLflow / Langfuse / W&B** are experiment tracking (or a whole extra
server plus its own database) for a single-service RAG; the pino line already carries everything
those tools would ingest, so they can be added later without touching the ask path.
**pgvector** (consolidating the KB into Postgres) is the documented post-freeze move: `FaqStore`
and `TicketStore` are the swap seams, and the GATE would have to be re-run.

## Frontend

`frontend/src/pages/FaqPage.tsx` (the `/faq` route) and `frontend/src/pages/FaqChatWidget.tsx`
share the ask/ticket state in `frontend/src/faq.ts`.

## Ingestion

```bash
npm run ingest -w faq-service   # chunks corpus/*.md by ## heading, upserts into Chroma
```

Idempotent: chunk ids are `source#heading-slug`, so re-running updates in place. Re-run after any
corpus or embedding-model change (a model change re-embeds everything).

## Run

```bash
docker compose up -d --build chroma faq-service   # or the whole stack
npm run ingest -w faq-service                      # build the knowledge base
```

API: see the endpoints table above. A refusal carries
`{ answer: null, suggestions[], escalation: { question, matchedTopics, userId } }`. Docs of the
error envelope match every other FoC service.
