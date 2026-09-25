# CS3219 — Software Design and Architecture (AY2627 Sem 1)

## Friend on Campus (FoC)

**Friend on Campus (FoC)** is a peer-to-peer campus errand platform where
students can request items to be collected from stores or facilities on
campus, and other students can fulfil (and deliver) those requests. The
platform runs on a closed credit economy — credits cannot be bought,
withdrawn, or exchanged for money, and only circulate within the platform.

---

## Team Members

| Name | Role |
| ----- | ----- |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |

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
├── <n2h-service>/
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

**First admin.** On the first start the User Service creates the admin from
`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_TEMP_PASSWORD` (you must change the
password at first login), then never again. Further admins need two admins:
one requests on *Admin: users*, a different one confirms on *Admin: role changes*.

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
