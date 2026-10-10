# Supplier Service

The Supplier Service manages the campus supplier catalog for **Friend on Campus (FoC)**. The catalog includes food stalls, cafes, bookstores, convenience stores, and printing facilities.

The service provides catalog search, multi-attribute filtering, and real-time open status for students. It also provides administrative endpoints for supplier management.

---

## 1. API Specifications

`supplier-service` adheres to contract-first design with two standardized interface specifications:

### 1.1 Client & Public REST API (OpenAPI 3.0)
[`openapi.yaml`](./openapi.yaml) defines the formal OpenAPI 3.0 contract for public catalog and admin HTTP endpoints.

To run a live mock server for local development without code:
```bash
npx @stoplight/prism-cli mock supplier-service/openapi.yaml -p 4010
```
Send requests to `http://localhost:4010/v1/suppliers`. The server returns mock data matching the schema.

### 1.2 Inter-Service Messaging RPC (AsyncAPI 3.0)
[`asyncapi.yaml`](./asyncapi.yaml) defines the formal AsyncAPI 3.0 contract for RabbitMQ Direct Reply-To RPC verification (`supplier.rpc.validate`) consumed by `order-service`.

---

## 2. Core Entities and Conventions

### Conventions
- **Base URL:** `/v1`
- **Direct Service URL:** `http://localhost:3002`
- **Through Web Gateway:** `http://localhost:5173/v1/suppliers` and `http://localhost:5173/v1/supplier-images`
- **Authentication:**
  - Standard user endpoints require `Authorization: Bearer <Keycloak access token>`.
  - Token verified against Keycloak's public keys (JWKS).
  - Admin endpoints require role `"admin"` in `realm_access.roles`.
  - Introspection verified against User Service (`POST /v1/internal/auth/introspect`, cached 5s, fails closed with 503).
  - `GET /v1/supplier-images/:file` is **public** without authentication so `<img>` tags render natively.
- **Pagination:** Query parameters `page` (1-indexed, default: 1) and `limit` (default: 20, max: 50).
- **Standard Response Envelopes:**
  - Single entity: `{ "data": ... }`
  - Paginated list: `{ "data": [...], "page": 1, "limit": 20, "total": 45 }`
  - Error envelope:
    ```json
    {
      "error": {
        "code": "STRING_CODE",
        "message": "Human readable description",
        "details": {}
      }
    }
    ```
- **Strict Request Validation:** Any unexpected field in mutation requests is strictly rejected with `422 VALIDATION_ERROR` (`"This field is not allowed."`).
- **Tracing:** Responses pass through or emit `X-Correlation-Id`.

---

### Schema: `Supplier`

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "name": "Cool Spot",
  "facilityType": "Food",
  "building": "Com 2",
  "floor": "1",
  "locationDescription": "Opp LT16",
  "latitude": 1.2940156,
  "longitude": 103.7738478,
  "opensAt": "09:00",
  "closesAt": "21:30",
  "isActive": true,
  "isOpenNow": true,
  "imageUrl": "/v1/supplier-images/COOL_SPOT.jpeg",
  "createdAt": "2026-09-01T08:00:00Z",
  "updatedAt": "2026-09-22T00:15:00Z"
}
```

#### Field Notes:
* `name`: Unique supplier name across the platform.
* `opensAt` & `closesAt`: 24h Singapore time (`HH:MM`). If `closesAt < opensAt` (e.g. `11:00` to `02:00`), the stall spans past midnight into the next morning.
* `isActive`: Administrative master switch (active vs deactivated/soft-deleted).
* `isOpenNow`: Dynamically computed boolean evaluated by the server based on current Singapore time vs `opensAt`, `closesAt`, and `isActive`.
* `latitude` & `longitude`: Nullable floating-point GPS coordinates for stall entrance pinpoints.
* `imageUrl`: Path to static image or S3 URL.

---

## 3. Endpoints Overview

### 3.1 Catalog and Browsing (`F7`)

| Method | Path | Description | Access |
| :--- | :--- | :--- | :--- |
| `GET` | `/v1/suppliers` | List suppliers with filtering, sorting, & pagination | Logged-in User |
| `GET` | `/v1/suppliers/filter-options` | Get distinct facility types and buildings | Logged-in User |
| `GET` | `/v1/suppliers/{id}` | Get full details for a single supplier | Logged-in User |
| `GET` | `/v1/supplier-images/{file}` | Get store image JPEG | **Public** (no auth) |

#### Query Parameters for `GET /v1/suppliers`:
* `search` *(string, max 100)*: Case-insensitive substring search matching name, building, or location description (`F7.2.2`).
* `facilityType` *(string)*: One or more comma-separated facility types (e.g. `Food,Food/Coffee`) (`F7.2.1`).
* `building` *(string)*: Exact filter by campus building, case-insensitive (`F7.2.1`).
* `status` *(string, default `active`)*: `active` | `open_now` | `inactive` (Admin) | `all` (Admin) (`F7.2.3`).
* `sort` *(string, default `name`)*: `name` | `location` | `facilityType` (`F7.3.1`, `F7.3.2`).
* `order` *(string, default `asc`)*: `asc` | `desc`.
* `page` *(integer, default `1`)*: 1-indexed page number.
* `limit` *(integer, default `20`, max `50`)*: Records per page.

---

### 3.2 Admin Management (`F8`, `F9`, `F10`)
*All require `Authorization: Bearer <Keycloak access token>` with role `"admin"` in `realm_access.roles`.*

| Method | Path | Description | Access |
| :--- | :--- | :--- | :--- |
| `POST` | `/v1/suppliers` | Create a supplier (`F8.1`) | Admin |
| `PATCH` | `/v1/suppliers/{id}` | Update supplier details (`F9.3`) | Admin |
| `PATCH` | `/v1/suppliers/{id}/deactivate` | Soft-deactivate an active supplier (`F9.1`) | Admin |
| `PATCH` | `/v1/suppliers/{id}/reactivate` | Reactivate a deactivated supplier (`F9.2`) | Admin |
| `DELETE` | `/v1/suppliers/{id}` | Permanently delete a supplier (`F10.1.1`) | Admin |
| `DELETE` | `/v1/suppliers?facilityType=...&confirm=true` | Bulk delete suppliers by category (`F10.1.2`) | Admin |

---

### 3.3 Service-to-Service Internal Endpoints
*Requires header `X-Internal-Auth: <INTERNAL_AUTH_SECRET>`. Requests carrying user `Authorization` Bearer tokens are rejected with `403 USER_TOKEN_NOT_ALLOWED`.*

| Method | Path | Description | Access |
| :--- | :--- | :--- | :--- |
| `GET` | `/v1/internal/suppliers/{id}/validate` | Validate supplier existence, active status, and open status for Order Service | FoC Backend Services |

#### Validation Response Format:
```json
{
  "data": {
    "exists": true,
    "isActive": true,
    "isOpenNow": true,
    "valid": true,
    "reason": null,
    "supplier": {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "name": "Cool Spot",
      "facilityType": "Food",
      "building": "Com 2",
      "floor": "1",
      "locationDescription": "Opp LT16",
      "opensAt": "09:00",
      "closesAt": "21:30"
    }
  }
}
```
* `reason`: `NOT_FOUND` (supplier ID does not exist), `INACTIVE` (deactivated), `CLOSED` (outside operating hours), or `null` when valid.

---

### 3.4 Direct Reply-To RPC Validation (RabbitMQ)
*Queue:* `supplier.rpc.validate` | *Reply Exchange:* `amq.rabbitmq.reply-to`

Direct Reply-To RPC consumer providing decoupled, low-latency supplier verification for `order-service` checkout sagas.

#### Dual-Temporal Validation Semantics:
1. **Store Cutoff Window (`message.timestamp`)**: Evaluates operating hours against `(closesAt - 15 minutes)` in Singapore time (`Asia/Singapore`). If the customer checkout timestamp occurred within 15 minutes of closing or after close, the order fails with `valid: false, reason: 'CLOSED'`.
2. **Queue Staleness & Expiry (`Date.now()`)**:
   - The RPC consumer evaluates queue latency on message arrival: `queue_latency = Date.now() - message.timestamp`.
   - **Performance Expectation:** This check is designed to be **instantaneous** (<50ms round-trip).
   - **Friction Ceiling:** A latency of 60 seconds is already at the extreme upper bound of acceptable interactive checkout friction. If `queue_latency > 60s`, the consumer immediately rejects the request with `valid: false, reason: 'QUEUE_TIMEOUT_EXPIRED'` without querying the database or ringing merchant terminals, protecting against backlog drainage or worker restart delays.

#### RPC Request Payload:
```json
{
  "supplierId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "timestamp": "2026-09-24T12:00:00.000Z"
}
```

#### RPC Response Payload:
```json
{
  "exists": true,
  "isActive": true,
  "isOpenNow": true,
  "valid": true,
  "reason": null,
  "supplier": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "Cool Spot",
    "facilityType": "Food",
    "building": "Com 2",
    "floor": "1",
    "locationDescription": "Opp LT16",
    "opensAt": "09:00",
    "closesAt": "21:30"
  }
}
```
* `reason`: `NOT_FOUND`, `INACTIVE`, `CLOSED`, `QUEUE_TIMEOUT_EXPIRED`, or `null`.

---

## 4. Requirements Traceability


| Requirement | Description | Implementation |
| :--- | :--- | :--- |
| **F7.1** | Display suppliers with names and attributes | `GET /v1/suppliers`, `GET /v1/suppliers/{id}` |
| **F7.1.1** | Unique supplier name verification | Enforced on `POST /v1/suppliers` and `PATCH /v1/suppliers/{id}` (`409 SUPPLIER_NAME_TAKEN`) |
| **F7.1.2** | Display facility type | `Supplier.facilityType` |
| **F7.1.3** | Display location (building, floor, coordinates) | `Supplier.building`, `Supplier.floor`, `Supplier.latitude`, `Supplier.longitude` |
| **F7.1.4** | Display operating hours & active status | `Supplier.opensAt`, `Supplier.closesAt`, `Supplier.isActive`, `Supplier.isOpenNow` |
| **F7.2.1** | Filter by location & facility type | `GET /v1/suppliers?building=...&facilityType=...` |
| **F7.2.2** | Filter by supplier name | `GET /v1/suppliers?search=...` |
| **F7.2.3** | Filter by operating status | `GET /v1/suppliers?status=open_now` |
| **F7.3.1** | Sort by location and facility type | `GET /v1/suppliers?sort=location` or `sort=facilityType` |
| **F7.3.2** | Sort alphabetically by name | `GET /v1/suppliers?sort=name&order=asc` |
| **F8.1** | Create new supplier (Admin) | `POST /v1/suppliers` |
| **F9.1** | Deactivate supplier (retains historical records) | `PATCH /v1/suppliers/{id}/deactivate` |
| **F9.2** | Reactivate supplier | `PATCH /v1/suppliers/{id}/reactivate` |
| **F9.3** | Update supplier info | `PATCH /v1/suppliers/{id}` |
| **F10.1.1**| Delete supplier by targeted ID | `DELETE /v1/suppliers/{id}` |
| **F10.1.2**| Bulk delete suppliers by category | `DELETE /v1/suppliers?facilityType=...&confirm=true` |
