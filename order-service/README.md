# Order Service

Errand orders and their lifecycle: a requester posts an order for items from a campus supplier, a runner accepts,
collects and delivers it, and the requester confirms. Credits are reserved, returned and paid by Credit Service,
driven by this service's events.

Port **3004**. Own database `orders_db`. Reached only through the gateway (`/v1/orders` in `frontend/nginx.conf`).

## Status flow

```
create ─► PENDING ─► OPEN ─► ACCEPTED ─► COLLECTED ─► DELIVERED ─► COMPLETED
             │        │  ◄─withdraw─┘                     (confirm, or auto after 24h)
             ▼        ├─► CANCELLED  (requester)
          REJECTED    └─► EXPIRED    (expiry job)
   (credit failed or no reply in 120s)
```

Full table (who, conditions, credit effect, event): [docs/state-transitions.md](docs/state-transitions.md), generated
from `src/domain/transitions.ts` by `npm run docs:transitions`. Any other change returns 409.

## API

All `/v1/orders` routes need `Authorization: Bearer <Keycloak access token>` and a live, non-suspended session.
Responses: `{ data }`, lists `{ data, page, limit, total }`, errors `{ error: { code, message, details? } }`.

| Method | Path                                           | Who                                      | Result                                                                |
| ------ | ---------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| POST   | `/v1/orders`                                   | any user (becomes requester)             | **202** PENDING order + `Location` header                             |
| GET    | `/v1/orders`                                   | any user                                 | OPEN, unexpired orders from other people                              |
| GET    | `/v1/orders/mine?as=requester\|runner&status=` | caller                                   | the caller's orders in that role                                      |
| GET    | `/v1/orders/by-user/:userId?status=`           | admin                                    | orders where the user is requester or runner                          |
| GET    | `/v1/orders/:id`                               | requester, runner, admin; OPEN: any user | order + `requester` / `runner` summaries                              |
| GET    | `/v1/orders/:id/timeline`                      | requester, runner, admin                 | status history                                                        |
| POST   | `/v1/orders/:id/accept`                        | anyone except the requester              | OPEN → ACCEPTED                                                       |
| POST   | `/v1/orders/:id/withdraw`                      | assigned runner                          | ACCEPTED → OPEN (expiry unchanged)                                    |
| POST   | `/v1/orders/:id/collect`                       | assigned runner                          | ACCEPTED → COLLECTED                                                  |
| POST   | `/v1/orders/:id/deliver`                       | assigned runner                          | COLLECTED → DELIVERED                                                 |
| POST   | `/v1/orders/:id/confirm`                       | requester                                | DELIVERED → COMPLETED; already COMPLETED → 200, no change             |
| POST   | `/v1/orders/:id/cancel`                        | requester                                | OPEN → CANCELLED                                                      |
| GET    | `/health/live`, `/health/ready`                | internal only                            | `ready`: `checks: { db, broker }`; 503 only if the DB is down         |
| GET    | `/metrics`                                     | internal only                            | broker state, outbox backlog and publish lag, dead-letter queue depth |

Create body: `{ supplierId, deliveryLocation, items: string[], creditAmount, expiresAt }`. `expiresAt` must be in
the future and at most 24h away (database time).

List filters for `GET /v1/orders`: `supplierId`, `building`, `facilityType`, `deliveryLocation` (contains),
`minCredit`, `maxCredit`, `minRemainingMinutes`, `maxRemainingMinutes`, `sort=expiry|credit`, `order=asc|desc`,
`page`, `limit` (max 50).

| Status | Codes                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 400    | `EXPIRY_NOT_IN_FUTURE`, `EXPIRY_TOO_FAR`, `SUPPLIER_NOT_FOUND`, `SUPPLIER_INACTIVE`, `SUPPLIER_CLOSED`, `INVALID_RANGE`       |
| 401    | `TOKEN_MISSING`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `SESSION_REVOKED`                                                          |
| 403    | `CANNOT_ACCEPT_OWN_ORDER`, `NOT_ORDER_PARTICIPANT`, `RUNNER_ONLY`, `REQUESTER_ONLY`, `INSUFFICIENT_ROLE`, `ACCOUNT_SUSPENDED` |
| 404    | `ORDER_NOT_FOUND`                                                                                                             |
| 409    | `ALREADY_ACCEPTED`, `ORDER_EXPIRED`, `ILLEGAL_TRANSITION`                                                                     |
| 422    | `VALIDATION_ERROR` (with `details.fieldErrors`)                                                                               |
| 503    | `SUPPLIER_UNAVAILABLE`, `AUTH_SERVICE_UNAVAILABLE`                                                                            |

## Calls to other services

| Service  | Call                                      | Used for                                                                    |
| -------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| Supplier | `GET /v1/internal/suppliers/:id/validate` | create: exists, active, open now; snapshot name and location onto the order |
| User     | `GET /v1/internal/users/:id/summary`      | detail view: display name and rating (null if the call fails)               |
| User     | `POST /v1/internal/auth/introspect`       | every request: session live, account not suspended (via shared-middleware)  |

All send `X-Internal-Auth` and `X-Correlation-Id`, with a `HTTP_TIMEOUT_MS` timeout.

## Events

Envelope from `@foc/shared-events`: `{ eventId, type, version, occurredAt, correlationId, payload }`. Every payload
also has `orderVersion` (goes up by 1 on every change).

**Published** to the `order.events` topic exchange, through the transactional outbox (`outbox_events`, written in the
same transaction as the change; the shared relay publishes with confirms):

| Routing key                                    | When                            | Payload                                        | Credit effect                 |
| ---------------------------------------------- | ------------------------------- | ---------------------------------------------- | ----------------------------- |
| `order.created`                                | create                          | `orderId, requesterId, creditAmount`           | Credit reserves, then replies |
| `order.opened`                                 | credit reserved                 | `orderId, requesterId`                         | none                          |
| `order.rejected`                               | reservation failed or timed out | `orderId, requesterId, reason`                 | Credit returns any late hold  |
| `order.accepted` / `.collected` / `.delivered` | runner steps                    | `orderId, requesterId, runnerId`               | none                          |
| `order.reopened`                               | runner withdraws                | `orderId, requesterId, previousRunnerId`       | none                          |
| `order.completed`                              | confirm or auto-confirm         | `orderId, requesterId, runnerId, creditAmount` | pay the runner                |
| `order.cancelled`                              | requester cancels               | `orderId, cancelledBy`                         | return to requester           |
| `order.expired`                                | expiry job                      | `orderId`                                      | return to requester           |

`order.created/completed/cancelled/expired` use `ORDER_EVENTS` from shared-events. The others are defined in
`src/events/localEvents.ts` until they are added to shared-events. `order.withdrawn` is not used: Credit Service
treats it as a refund, but a runner withdrawing does not return any credits.

**Consumed** from the `credit.events` exchange, queue `order-service.credit-events`:

| Routing key                 | Effect                                                    |
| --------------------------- | --------------------------------------------------------- |
| `credit.reserved`           | PENDING → OPEN                                            |
| `credit.reservation_failed` | PENDING → REJECTED, saves `reason` and `availableBalance` |

Each event is applied once (`processed_events`, same transaction). A failing message is retried every
`CONSUMER_RETRY_DELAY_MS` (queue `...credit-events.retry`), and after 5 attempts moved to `...credit-events.dlq`.

### Needed from Credit Service

1. On `order.created`: reserve, then publish `credit.reserved` or `credit.reservation_failed`
   `{ orderId, requesterId, amount, availableBalance, reason: 'INSUFFICIENT_CREDITS' | 'NO_WALLET' }`
   (add it to `CREDIT_EVENTS`).
2. On `order.rejected`: return any hold, and never reserve for that order later.
3. On `order.cancelled` / `order.expired`: return to the requester. On `order.completed`: pay the runner.

Until then, `npm run mock:credit` stands in for it (see `mocks/credit-mock.ts`).

## Jobs

One timer (`EXPIRY_SWEEP_MS`, 30s) runs, one after another, using the same conditional UPDATE as the API:

- OPEN past `expires_at` → EXPIRED
- DELIVERED longer than `AUTO_CONFIRM_AFTER_HOURS` (24) → COMPLETED
- PENDING longer than `PENDING_TIMEOUT_SECONDS` (120) → REJECTED (`CREDIT_TIMEOUT`)

Every 30s the outbox monitor logs backlog, publish lag and DLQ depth, and warns if an event has waited over 60s.

## Environment variables

See [.env.example](.env.example). `DATABASE_URL` and `INTERNAL_AUTH_SECRET` are required. Leaving `AMQP_URL` empty
runs without RabbitMQ: events stay in the outbox and credit replies are not consumed.

## How to run

**With the whole stack.** Paste the snippets first (see [snippets/workspace.md](snippets/workspace.md)):
`compose.order.yaml` into `compose.yaml`, `nginx.order.conf` into `frontend/nginx.conf`, `env.order.example` into
`.env.example` and your `.env`. Then from the repo root:

```bash
docker compose up -d --build
docker compose exec order-service node order-service/dist/seed.js   # optional demo data
```

Migrations run when the service starts. Postman collection and demo script: [postman/](postman/).

**Tests.** Only Postgres is needed (any Postgres 16; the tests create and drop an `orders_test` database):

```bash
docker run -d --name orders-sql-test -e POSTGRES_PASSWORD=test -p 5436:5432 postgres:16-alpine
cd order-service && npx vitest run
# with the stack's orders-db instead: ORDERS_TEST_ADMIN_URL=postgres://orders:<password>@localhost:5436/postgres
```

The RabbitMQ tests are skipped unless `ORDERS_TEST_AMQP_URL` is set:

```bash
ORDERS_TEST_AMQP_URL=amqp://<user>:<password>@localhost:5672 npx vitest run test/rabbit.test.ts
```

**Scripts:** `build`, `start`, `dev`, `typecheck`, `test`, `lint`, `format`, `format:check`, `seed`,
`docs:transitions`, `mock:credit`. `lint` and `format:check` need ESLint and Prettier installed, which happens once
`order-service` is in the root workspaces (`snippets/workspace.md`, step 3).

## Folder layout

```
src/
  routes/        URL → controller, auth middleware
  controllers/   parse request, send response
  services/      business rules: create/read (orderService), status changes (statusService, transitionService)
  repositories/  SQL
  domain/        statuses, the transition table
  clients/       HTTP calls to Supplier and User services
  events/        credit consumer, event definitions not yet in shared-events
  jobs/          expiry, auto-confirm, pending timeout, outbox monitor
  seed.ts        demo data
migrations/      SQL, applied at startup
mocks/           temporary Credit Service stand-in
snippets/        wiring to paste into files outside order-service/
postman/         collection and demo script
```
