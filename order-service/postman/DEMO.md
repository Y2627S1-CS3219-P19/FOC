# Order Service demo script

About 10 minutes. One happy path and two failure cases, using `order-service.postman_collection.json`.

## Before the demo

1. `ORDERS_DB_PASSWORD` is in your `.env` (see `.env.example`), and the stack is up: `docker compose up -d --build`.
2. Three users exist in Keycloak with verified emails (requester, runner, second runner), plus an admin. Put their
   usernames and passwords in the collection variables.
3. Credit Service does not reserve credits yet, so run the temporary mock against the stack's RabbitMQ (in a terminal
   you can show):

   ```bash
   cd order-service
   AMQP_URL=amqp://<RABBITMQ_USER>:<RABBITMQ_PASSWORD>@localhost:5672 MOCK_MODE=success npm run mock:credit
   ```

4. Optional: `docker compose exec order-service node order-service/dist/seed.js` for orders in every status.
5. Open three windows: Postman, the RabbitMQ UI (http://localhost:15672, queue `debug.all-order-events`), and
   `docker compose logs -f order-service`.

## 1. Happy path

| Step | Request (folder)                               | What to point out                                                                                       |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1    | `0. Log in` (all four)                         | Tokens come from Keycloak; Order Service checks them itself                                             |
| 2    | `1. Pick a supplier`                           | Supplier Service; only suppliers open right now                                                         |
| 3    | `2. Create order`                              | **202 PENDING**. Logs: `Order created` with the correlation id. RabbitMQ UI: `order.created`            |
| 4    | `2. Get order (wait until OPEN)`               | Mock replied `credit.reserved` → **OPEN**. Logs: `Order transition` PENDING → OPEN, same correlation id |
| 5    | `3. List open orders` (runner) and the filters | Only OPEN orders from other people; filters, sort, pages                                                |
| 6    | `4. Requester accepts own order`               | **403 CANNOT_ACCEPT_OWN_ORDER**: decided by the order, not the account role                             |
| 7    | `4. Accept (runner)` → `Collect` → `Deliver`   | Each step is one conditional UPDATE + history + event                                                   |
| 8    | `4. Confirm (requester)`                       | **COMPLETED**; `order.completed` carries `runnerId` and `creditAmount` so Credit can pay the runner     |
| 9    | `4. Confirm again`                             | **200**, nothing changes, no second `order.completed` (check the RabbitMQ UI)                           |
| 10   | `4. Timeline`                                  | Every step with who did it                                                                              |

## 2. Failure: not enough credits

1. Stop the mock (Ctrl+C) and start it with `MOCK_MODE=insufficient`.
2. Run `2. Create order` → **202 PENDING**.
3. Run `GET /v1/orders/{{orderId}}` (the "Get order" request; it stops polling once the status changes) →
   **REJECTED** with `rejection: { reason: "INSUFFICIENT_CREDITS", availableBalance: 2 }`.
4. Point out: no credits were taken, the order never appeared in the open list, and the requester sees exactly why.

Variation: `MOCK_MODE=silent`. Credit never answers, and after `PENDING_TIMEOUT_SECONDS` (120s) the job rejects
the order with `CREDIT_TIMEOUT`.

## 3. Failure: two runners accept the same order

1. Back to `MOCK_MODE=success`. Create an order and wait until OPEN.
2. `4. Accept (runner)` → **200**. `4. Second runner accepts` → **409 ALREADY_ACCEPTED**.
3. `4. Other user collects` → **403 NOT_ORDER_PARTICIPANT**.
4. For the "what if they press at the same moment" question, run the concurrency tests:

   ```bash
   cd order-service && npx vitest run test/status.test.ts -t concurrency
   ```

   50 parallel accepts → exactly 1 winner and 49 × 409. Accept racing cancel → one outcome per order.

## If asked

- **Where are the rules?** `src/domain/transitions.ts`. `docs/state-transitions.md` is generated from it.
- **What if RabbitMQ is down?** Orders still work. Events wait in `outbox_events` and are sent when it is back.
  `/health/ready` shows `DEGRADED`. Inside the network: `docker compose exec order-service wget -qO- localhost:3004/metrics`.
- **What if Credit sends the same reply twice?** `processed_events` skips it (test: `creditConsumer.test.ts`).
- **What if a reply always fails?** 5 attempts, 5s apart, then the dead-letter queue (test: `rabbit.test.ts`).
