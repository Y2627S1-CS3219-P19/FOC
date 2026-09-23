# Supplier Service

The Supplier Service manages the campus supplier catalog (food stalls, cafes, bookstores, convenience stores, and printing facilities) for **Friend on Campus (FoC)**. 

It provides catalog search, multi-attribute filtering, and real-time open status for students, as well as administrative endpoints for supplier management and catalog maintenance.

---

## 1. API Specification

The formal machine-readable OpenAPI 3.0 contract is defined in [`openapi.yaml`](./openapi.yaml).

### Quick Mock Server (For Frontend & Teammates)
To run a zero-code live mock server against this contract for local development:

```bash
# Using Prism (instant mock server)
npx @stoplight/prism-cli mock supplier-service/openapi.yaml -p 4010
```

You can now send requests to `http://localhost:4010/v1/suppliers` and receive mock data conforming to the schema.

---

## 2. Core Entities & Conventions

### Conventions
- **Base URL:** `/v1`
- **Authentication:**
  - Standard user endpoints: Accessible with or without `Authorization: Bearer <jwt>`.
  - Admin endpoints: Require `Authorization: Bearer <jwt>` containing claim `role: "admin"`.
- **Pagination:** Query parameters `limit` (default: 20, max: 100) and `offset` (default: 0).
- **Standard Error Envelope:**
  ```json
  {
    "error": "NAME_EXISTS",
    "message": "Supplier with this name already exists"
  }
  ```

---

### Schema: `Supplier`

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "name": "Cool Spot",
  "facility_type": "Food",
  "location": {
    "building": "Com 2",
    "floor": "1",
    "description": "Opp LT16",
    "latitude": 1.2940156,
    "longitude": 103.7738478
  },
  "operating_hours": [
    {
      "day_of_week": "MONDAY",
      "open_time": "09:00",
      "close_time": "21:30"
    },
    {
      "day_of_week": "FRIDAY",
      "open_time": "11:00",
      "close_time": "02:00"
    }
  ],
  "is_active": true,
  "is_open": true,
  "image_url": "https://raw.githubusercontent.com/.../COOL_SPOT.jpeg",
  "created_at": "2026-09-01T08:00:00Z",
  "updated_at": "2026-09-22T00:15:00Z"
}
```

#### Field Notes:
* `name`: Unique supplier name across the platform.
* `operating_hours`: List of scheduled day shifts. **Days that are closed are simply omitted**.
* `operating_hours[].close_time`: If `close_time < open_time` (e.g. `11:00` to `02:00`), the shift spans past midnight into the next morning.
* `is_active`: Administrative master switch (active vs deactivated/soft-deleted).
* `is_open`: Dynamically computed boolean returned by the server based on the current clock time vs `operating_hours` and `is_active`.
* `location.latitude` & `location.longitude`: Nullable floating-point GPS coordinates.

---

## 3. Endpoints Overview

### 3.1 Catalog & Browsing (`F7`)

| Method | Path | Description | Access |
| :--- | :--- | :--- | :--- |
| `GET` | `/v1/suppliers` | List suppliers with filtering, sorting, & pagination | Public / User |
| `GET` | `/v1/suppliers/{id}` | Get full details for a single supplier | Public / User |

#### Query Parameters for `GET /v1/suppliers`:
* `query` *(string)*: Case-insensitive substring search matching supplier name (`F7.2.2`).
* `facility_type` *(string)*: Exact filter by facility type (e.g. `Food`, `Printing`) (`F7.2.1`).
* `building` *(string)*: Exact filter by campus building (e.g. `Com 2`, `Central Library`) (`F7.2.1`).
* `open_only` *(boolean, default `false`)*: If `true`, returns only suppliers currently open and active (`F7.2.3`).
* `sort_by` *(string)*: `name` | `building` | `facility_type` (default `name`) (`F7.3.1`, `F7.3.2`).
* `sort_order` *(string)*: `asc` | `desc` (default `asc`).
* `limit` *(integer, default `20`)*: Records per page.
* `offset` *(integer, default `0`)*: Record offset.

---

### 3.2 Admin Management (`F8`, `F9`, `F10`)
*All require `Authorization: Bearer <jwt>` with `role: "admin"`.*

| Method | Path | Description | Access |
| :--- | :--- | :--- | :--- |
| `POST` | `/v1/suppliers` | Create a new supplier (`F8.1`) | Admin |
| `PATCH` | `/v1/suppliers/{id}` | Update supplier details (`F9.3`) | Admin |
| `POST` | `/v1/suppliers/{id}/deactivate` | Soft-deactivate an active supplier (`F9.1`) | Admin |
| `POST` | `/v1/suppliers/{id}/reactivate` | Reactivate a deactivated supplier (`F9.2`) | Admin |
| `DELETE` | `/v1/suppliers/{id}` | Hard delete supplier (guarded by order history) (`F10.1.1`) | Admin |
| `DELETE` | `/v1/suppliers?facility_type=...` | Mass delete suppliers by category (`F10.1.2`) | Admin |

---

## 4. Functional Requirements Traceability

| Req ID | Description | Handled By |
| :--- | :--- | :--- |
| **F7.1** | Display suppliers with names and attributes | `GET /v1/suppliers`, `GET /v1/suppliers/{id}` |
| **F7.1.1** | Unique supplier name verification | Enforced on `POST /v1/suppliers` and `PATCH /v1/suppliers/{id}` (`409 Conflict`) |
| **F7.1.2** | Display facility type | `Supplier.facility_type` |
| **F7.1.3** | Display location (building, floor, coordinates) | `Supplier.location` |
| **F7.1.4** | Display operating hours & active status | `Supplier.operating_hours`, `Supplier.is_active`, `Supplier.is_open` |
| **F7.2.1** | Filter by location & facility type | `GET /v1/suppliers?building=...&facility_type=...` |
| **F7.2.2** | Filter by supplier name | `GET /v1/suppliers?query=...` |
| **F7.2.3** | Filter by operating status (excluding closed/deactivated) | `GET /v1/suppliers?open_only=true` |
| **F7.3.1** | Sort by location and facility type | `GET /v1/suppliers?sort_by=building` or `facility_type` |
| **F7.3.2** | Sort alphabetically by name | `GET /v1/suppliers?sort_by=name&sort_order=asc` |
| **F8.1** | Create new supplier (Admin) | `POST /v1/suppliers` |
| **F9.1** | Deactivate supplier (retain historical associations) | `POST /v1/suppliers/{id}/deactivate` |
| **F9.2** | Reactivate supplier | `POST /v1/suppliers/{id}/reactivate` |
| **F9.3** | Update supplier info | `PATCH /v1/suppliers/{id}` |
| **F10.1.1**| Delete supplier by targeted ID | `DELETE /v1/suppliers/{id}` |
| **F10.1.2**| Mass delete suppliers by category | `DELETE /v1/suppliers?facility_type=...` |
