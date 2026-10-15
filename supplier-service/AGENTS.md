# Supplier Service — Agent Guide

Conventions and API contracts for coding agents working on `supplier-service`.

## 1. Responsibilities & Boundaries

- Manages campus supplier records (food stalls, bookstores, printing shops).
- Strictly 3NF PostgreSQL database (`suppliers_db`).
- Rejects `"tags"` in mutations with `422 VALIDATION_ERROR`.
- Never import code directly from sibling services (`order-service/`, `user-service/`, etc.).

---

## 2. API Contracts

`supplier-service` exposes one external contract:

1. **North-South HTTP REST Contract:** [`openapi.yaml`](./openapi.yaml)
   - Public catalog search, filters, pagination (`/v1/suppliers`).
   - Admin CRUD (`POST`, `PATCH`, `DELETE /v1/suppliers`).
   - Mock server command: `npx @stoplight/prism-cli mock openapi.yaml -p 4010`.

Retired: the East-West RabbitMQ contract (`supplier.rpc.validate`, formerly `asyncapi.yaml`) was removed after the team decided on HTTP verification. The implementation and spec are preserved on the `spike/supplier-rpc` branch.

---

## 3. Order-Service Integration Guide

When `order-service` checks out an order, it verifies the stall over HTTP:
`GET /v1/internal/suppliers/:id/validate` with the `X-Internal-Auth` header
(internal endpoints reject user JWTs). See `routes/internal.ts`.

### Outcome Handling Matrix

| `reason` | Condition | Recommended HTTP Status / Action |
| :--- | :--- | :--- |
| `null` (`valid: true`) | Stall exists, active, and open for orders | `200 OK` $\rightarrow$ proceed with checkout |
| `NOT_FOUND` | Stall ID does not exist | `404 Not Found` (`SUPPLIER_NOT_FOUND`) |
| `INACTIVE` | Stall is soft-deactivated | `400 Bad Request` (`SUPPLIER_INACTIVE`) |
| `CLOSED` | Outside operating hours or order within 15-min cutoff | `400 Bad Request` (`SUPPLIER_CLOSED`) |

---

## 4. Local Development & Testing

```bash
cd supplier-service

# Run all 74 automated tests
npm test

# Build TypeScript
npm run build

# Build isolated Docker container (<8s)
docker build --no-cache -t supplier-service:test .
```
