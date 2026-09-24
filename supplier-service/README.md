# Supplier Service

The Supplier Service manages the campus supplier catalog for **Friend on Campus (FoC)**. The catalog includes food stalls, cafes, bookstores, convenience stores, and printing facilities.

The service provides catalog search, multi-attribute filtering, and real-time open status for students. It also provides administrative endpoints for supplier management.

---

## 1. API Specification

[`openapi.yaml`](./openapi.yaml) defines the formal OpenAPI 3.0 contract.

### Mock Server

To run a live mock server for local development without code:

```bash
# Run Prism mock server
npx @stoplight/prism-cli mock supplier-service/openapi.yaml -p 4010
```

Send requests to `http://localhost:4010/v1/suppliers`. The server returns mock data that matches the schema.

---

## 2. Core Entities and Conventions

### Conventions
- **Base URL:** `/v1`
- **Direct Service URL:** `http://localhost:3002`
- **Gateway URLs:** `http://localhost:5173/v1/suppliers` and `http://localhost:5173/v1/supplier-images`
- **Authentication:**
  - Standard user endpoints require `Authorization: Bearer <Keycloak access token>`.
  - The service verifies tokens against Keycloak public keys (JWKS).
  - Admin endpoints require the `admin` role in `realm_access.roles`.
  - The service checks session status with the User Service at `POST /v1/internal/auth/introspect`.
  - The service caches session checks for 5 seconds.
  - If the User Service is unavailable, the service rejects requests with HTTP 503 (`AUTH_SERVICE_UNAVAILABLE`).
  - `GET /v1/supplier-images/:file` is public. It does not require authentication, so HTML `<img>` elements load images directly.
- **Pagination:** Use query parameters `page` (starts at 1, default: 1) and `limit` (default: 20, maximum: 50).
- **Response Format:**
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
- **Input Validation:** The service strictly rejects unexpected fields in write requests with `422 VALIDATION_ERROR` (`"This field is not allowed."`).
- **Tracing:** The service returns an `X-Correlation-Id` header with each response.

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

#### Field Descriptions:
* `name`: Unique supplier name.
* `opensAt` and `closesAt`: Singapore time in 24-hour format (`HH:MM`). If `closesAt < opensAt` (for example, `11:00` to `02:00`), operating hours cross midnight into the next day.
* `isActive`: Administrative status switch. Shows if the supplier is active or deactivated.
* `isOpenNow`: Computed boolean value. The server evaluates current Singapore time against `opensAt`, `closesAt`, and `isActive`.
* `latitude` and `longitude`: Optional GPS coordinates for the stall entrance.
* `imageUrl`: Relative image path or external URL.

---

## 3. Endpoints Overview

### 3.1 Catalog and Browsing (`F7`)

| Method | Path | Description | Access |
| :--- | :--- | :--- | :--- |
| `GET` | `/v1/suppliers` | List suppliers with filtering, sorting, and pagination | User |
| `GET` | `/v1/suppliers/filter-options` | Get distinct facility types and buildings | User |
| `GET` | `/v1/suppliers/{id}` | Get details for one supplier | User |
| `GET` | `/v1/supplier-images/{file}` | Get store image file | Public |

#### Query Parameters for `GET /v1/suppliers`:
* `search` *(string, max 100)*: Substring search in name, building, or location description (`F7.2.2`).
* `facilityType` *(string)*: One or more comma-separated facility types (for example, `Food,Food/Coffee`) (`F7.2.1`).
* `building` *(string)*: Campus building name, case-insensitive (`F7.2.1`).
* `status` *(string, default `active`)*: `active`, `open_now`, `inactive` (Admin only), or `all` (Admin only) (`F7.2.3`).
* `sort` *(string, default `name`)*: Sort field: `name`, `location`, or `facilityType` (`F7.3.1`, `F7.3.2`).
* `order` *(string, default `asc`)*: Sort direction: `asc` or `desc`.
* `page` *(integer, default `1`)*: Page number (starts at 1).
* `limit` *(integer, default `20`, max `50`)*: Records per page.

---

### 3.2 Admin Management (`F8`, `F9`, `F10`)
*All requests require `Authorization: Bearer <Keycloak access token>` with role `"admin"` in `realm_access.roles`.*

| Method | Path | Description | Access |
| :--- | :--- | :--- | :--- |
| `POST` | `/v1/suppliers` | Create a supplier (`F8.1`) | Admin |
| `PATCH` | `/v1/suppliers/{id}` | Update supplier details (`F9.3`) | Admin |
| `PATCH` | `/v1/suppliers/{id}/deactivate` | Deactivate an active supplier (`F9.1`) | Admin |
| `PATCH` | `/v1/suppliers/{id}/reactivate` | Reactivate a deactivated supplier (`F9.2`) | Admin |
| `DELETE` | `/v1/suppliers/{id}` | Delete a supplier (`F10.1.1`) | Admin |
| `DELETE` | `/v1/suppliers?facilityType=...&confirm=true` | Delete suppliers by category (`F10.1.2`) | Admin |

---

## 4. Requirements Traceability

| Requirement | Description | Implementation |
| :--- | :--- | :--- |
| **F7.1** | Display suppliers with names and attributes | `GET /v1/suppliers`, `GET /v1/suppliers/{id}` |
| **F7.1.1** | Unique supplier name verification | Enforced in `POST /v1/suppliers` and `PATCH /v1/suppliers/{id}` (`409 SUPPLIER_NAME_TAKEN`) |
| **F7.1.2** | Display facility type | `Supplier.facilityType` |
| **F7.1.3** | Display location (building, floor, coordinates) | `Supplier.building`, `Supplier.floor`, `Supplier.latitude`, `Supplier.longitude` |
| **F7.1.4** | Display operating hours and active status | `Supplier.opensAt`, `Supplier.closesAt`, `Supplier.isActive`, `Supplier.isOpenNow` |
| **F7.2.1** | Filter by location and facility type | `GET /v1/suppliers?building=...&facilityType=...` |
| **F7.2.2** | Filter by supplier name | `GET /v1/suppliers?search=...` |
| **F7.2.3** | Filter by operating status | `GET /v1/suppliers?status=open_now` |
| **F7.3.1** | Sort by location and facility type | `GET /v1/suppliers?sort=location` or `sort=facilityType` |
| **F7.3.2** | Sort alphabetically by name | `GET /v1/suppliers?sort=name&order=asc` |
| **F8.1** | Create new supplier (Admin) | `POST /v1/suppliers` |
| **F9.1** | Deactivate supplier | `PATCH /v1/suppliers/{id}/deactivate` |
| **F9.2** | Reactivate supplier | `PATCH /v1/suppliers/{id}/reactivate` |
| **F9.3** | Update supplier details | `PATCH /v1/suppliers/{id}` |
| **F10.1.1**| Delete supplier by ID | `DELETE /v1/suppliers/{id}` |
| **F10.1.2**| Delete suppliers by category | `DELETE /v1/suppliers?facilityType=...&confirm=true` |

---

## 5. Developer Guide and Local Setup

### Prerequisites
- Node.js >= 22
- PostgreSQL 16 (port `5434` for `suppliers_db`)

### Installation
```bash
cd supplier-service
cp .env.example .env
npm install
```

### Database Migrations and Seeding
Run database migrations and seed scripts manually. The application does not run migrations during startup:
```bash
# Generate SQL migrations from schema
npm run db:generate

# Apply pending SQL migrations to PostgreSQL
npm run db:migrate

# Seed the 21 initial campus suppliers from data/csv/supplier-seed-data.csv
npm run db:seed
```

### Run the Service
```bash
# Start development server with file watching
npm run dev

# Build and run production server
npm run build
npm start
```

### Run Automated Tests
```bash
# Run all 58 unit and integration tests (Vitest)
npm test
```
The test suite covers:
- **Time Engine**: `isOpenNow` for daytime shifts and overnight shifts that cross midnight.
- **Seed Parser**: Converts CSV hours (`0900hrs` to `09:00`) and preserves image URLs.
- **Strict 3NF Validation**: Rejects `tags` with `422 VALIDATION_ERROR`.
- **Public Routes**: Health endpoints and public image delivery.
- **Two-Tier Authentication**: Keycloak JWKS verification, RBAC, and User Service session checks with 503 fail-closed behavior.
- **Catalog and Admin Operations**: Search, multi-attribute filtering, sorting, pagination, and admin CRUD.

