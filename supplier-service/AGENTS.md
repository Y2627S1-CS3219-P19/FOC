# Supplier Service — Agent Guide

Conventions and API contracts for coding agents working on `supplier-service`.

## 1. Responsibilities & Boundaries

- Manages campus supplier records (food stalls, bookstores, printing shops).
- Strictly 3NF PostgreSQL database (`suppliers_db`).
- Rejects `"tags"` in mutations with `422 VALIDATION_ERROR`.
- Never import code directly from sibling services (`order-service/`, `user-service/`, etc.).

---

## 2. API Contracts

`supplier-service` exposes two external contracts:

1. **North-South HTTP REST Contract:** [`openapi.yaml`](./openapi.yaml)
   - Public catalog search, filters, pagination (`/v1/suppliers`).
   - Admin CRUD (`POST`, `PATCH`, `DELETE /v1/suppliers`).
   - Mock server command: `npx @stoplight/prism-cli mock openapi.yaml -p 4010`.

2. **East-West RabbitMQ Messaging Contract:** [`asyncapi.yaml`](./asyncapi.yaml)
   - Queue: `supplier.rpc.validate`
   - Mechanism: RabbitMQ Direct Reply-To (`amq.rabbitmq.reply-to`).
   - Used by `order-service` to verify supplier eligibility during checkout.

---

## 3. Order-Service Integration Guide

When `order-service` checks out an order, it must verify the stall via RabbitMQ RPC.

### Client Helper
Import the helper from `@foc/shared-events`:
```typescript
import { createSupplierRpcClient } from '@foc/shared-events';

const client = createSupplierRpcClient(channel);
const response = await client.validateSupplier({
  supplierId: order.supplierId,
  // timestamp defaults to new Date().toISOString()
});
```

### Outcome Handling Matrix

| `response.reason` | Condition | Recommended HTTP Status / Action |
| :--- | :--- | :--- |
| `null` (`valid: true`) | Stall exists, active, and open for orders | `200 OK` $\rightarrow$ proceed with checkout |
| `NOT_FOUND` | Stall ID does not exist | `404 Not Found` (`SUPPLIER_NOT_FOUND`) |
| `INACTIVE` | Stall is soft-deactivated | `400 Bad Request` (`SUPPLIER_INACTIVE`) |
| `CLOSED` | Outside operating hours or order within 15-min cutoff | `400 Bad Request` (`SUPPLIER_CLOSED`) |
| `QUEUE_TIMEOUT_EXPIRED` | Message queue latency exceeded 60 seconds | `409 Conflict` (`QUEUE_TIMEOUT_EXPIRED`) $\rightarrow$ fail fast and refund customer |

---

## 4. Local Development & Testing

```bash
cd supplier-service

# Run all 84 automated tests
npm test

# Build TypeScript
npm run build

# Build isolated Docker container (<8s)
docker build --no-cache -t supplier-service:test .
```
