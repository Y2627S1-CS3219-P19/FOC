# AGENTS.md — order-service

Local rules for coding agents. The root `AGENTS.md` applies too.

## Shape

- Request path: `routes/` → `controllers/` (parse with zod `parseOrThrow`, send `{ data }`) → `services/` (rules) →
  `repositories/` (SQL only). Keep each layer to its job.
- Raw SQL with `pg`, parameters only (`$1`), never string-built user input. All time checks use database `now()`.
- Errors: throw `AppError` helpers from `@foc/shared-middleware` (`badRequest`, `forbidden`, `notFound`, `conflict`,
  `serviceUnavailable`). Bad input is 422 via `parseOrThrow`.

## Status changes

- Every status change goes through `TRANSITIONS` in `src/domain/transitions.ts` and `applyTransition()` in
  `src/services/transitionService.ts`: one conditional UPDATE + history row + outbox event, in one transaction.
  Never `UPDATE orders SET status` anywhere else, and never read-then-write a status.
- Who may act is decided by the order (`requester_id` / `runner_id`), never by the account role. Admins can read
  everything but get no extra transition rights.
- After changing `TRANSITIONS`, run `npm run docs:transitions` and commit `docs/state-transitions.md`.

## Events

- Publish only by `addOutboxEvent()` inside the same transaction as the change. Never publish to RabbitMQ directly.
- Use `ORDER_EVENTS` / `CREDIT_EVENTS` from `@foc/shared-events` when they exist; otherwise add to
  `src/events/localEvents.ts` and note it for the shared package. Do not use `order.withdrawn`.
- Consumers must record the event in `processed_events` in the same transaction as the change.

## Other services

- Only through `src/clients/` (HTTP, `/v1/internal/*`, `X-Internal-Auth`, timeout) or events. No imports from other
  service folders, no access to their databases. Do not store user personal data; fetch summaries on read.

## Files

- Stay inside `order-service/` unless the change is wiring: `compose.yaml` (`orders-db`, `order-service`),
  `frontend/nginx.conf` (`/v1/orders`), root `.env.example` (`ORDERS_DB_PASSWORD`), root `package.json` workspaces.
  Every service Dockerfile copies `order-service/package.json`; keep that line if you touch them.
- `mocks/` is temporary; delete it when Credit Service replies to `order.created` itself.

## Before you hand off

```bash
npx tsc -p tsconfig.json --noEmit
npx vitest run                     # needs Postgres on :5436 (see README)
npm run lint && npm run format:check
```
