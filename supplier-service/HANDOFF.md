# Handoff Document: Supplier Service Backend & Container Architecture

## 1. Context & Repository State
* **Current Service**: [`supplier-service/`](file:///Users/keaharvan/Documents/University/y4s1/cs3219/FOC/supplier-service/)
* **Integration Target Branch**: `staging` (all future PRs merge to `staging` before `main`).
* **Merged Upstream PRs**:
  * [PR #4](https://github.com/Y2627S1-CS3219-P19/FOC/pull/4): Fastify 5 backend with 3NF Drizzle ORM and test suite.
  * [PR #7](https://github.com/Y2627S1-CS3219-P19/FOC/pull/7): Automated startup database migrations, idempotent seeding, and container optimizations.
  * [PR #9](https://github.com/Y2627S1-CS3219-P19/FOC/pull/9): Internal supplier validation endpoint (`GET /v1/internal/suppliers/:id/validate`) for `order-service`.
* **Status**: Complete production-ready microservice. All 73 automated tests pass.

---

## 2. Key Architecture & Design Choices

| Area | Choice | Rationale |
| :--- | :--- | :--- |
| **Runtime & Framework** | Node.js 22 + TypeScript + **Fastify 5** | High-performance, schema-driven, native JSON serialization |
| **Database & ORM** | PostgreSQL 16 (`suppliers_db`) + **Drizzle ORM** | Type-safe SQL builder; migrations run automatically on boot |
| **Normalization** | **Strict 3NF with Zero Tags** | Atomic scalar columns; `"tags"` rejected with `422 VALIDATION_ERROR` |
| **Public Assets** | `GET /v1/supplier-images/:file` via `@fastify/static` | Static image delivery from `data/images/` without auth headers |
| **Two-Tier Authentication** | Keycloak JWKS + User Service Introspection | JWKS verification via `jose`, 5s cached introspection with fail-closed (`503`) |
| **Internal Inter-Service API** | `GET /v1/internal/suppliers/:id/validate` | Protected by `X-Internal-Auth` secret; allows `order-service` to validate supplier existence, active status, and opening hours |
| **RabbitMQ RPC Verification** | `supplier.rpc.validate` | Direct Reply-To RPC consumer with dual-temporal checks (15m store cutoff buffer + 60s queue staleness ceiling) |
| **Container Isolation** | Dedicated `context: ./supplier-service` + local lockfile | Zero dependencies on sibling folders or monorepo root lockfile; builds in <5s |
| **Testing** | **Vitest** (Unit, Integration, CLI Demos) | 84 passing tests across 12 test suites |

---

## 3. Directory Layout

```text
supplier-service/
├── .env.example                  # Environment placeholders (DATABASE_URL, KEYCLOAK, etc.)
├── Dockerfile                    # Multi-stage production container build (isolated context)
├── README.md                     # Full developer guide, API docs & traceability matrix
├── HANDOFF.md                    # This handoff document
├── drizzle.config.ts             # Drizzle Kit configuration
├── migrations/                   # Generated SQL schema migrations
├── package.json                  # Service dependencies, scripts (demo, demo:interactive, test)
├── package-lock.json             # Independent service lockfile
├── tsconfig.json                 # TypeScript ES2022 NodeNext configuration
├── vitest.config.ts              # Vitest runner configuration
├── scripts/
│   └── demo-interactive.js       # Interactive TUI terminal demo with persona switching
├── src/
│   ├── app.ts                    # Fastify buildApp factory
│   ├── index.ts                  # Server entry point; runs startup migrations & seed
│   ├── db/
│   │   ├── connection.ts         # PostgreSQL client & Drizzle DB instance
│   │   ├── drizzleRepository.ts  # Production PostgreSQL repository implementation
│   │   ├── migrate.ts            # Standalone migration runner (npm run db:migrate)
│   │   ├── repository.ts         # SupplierRepository interface & InMemory repository
│   │   ├── schema.ts             # 3NF Drizzle table definition
│   │   ├── seed.ts               # Idempotent CSV stall seeder (onConflictDoNothing)
│   │   └── seedParser.ts         # Pure CSV parser converting hours & URLs
│   ├── events/
│   │   └── rpcConsumer.ts        # RabbitMQ Direct Reply-To RPC consumer (supplier.rpc.validate)
│   ├── middleware/
│   │   ├── auth.ts               # Keycloak JWKS + User Service session introspection
│   │   └── errors.ts             # FoC standard error envelope and AppError classes
│   ├── routes/
│   │   ├── health.ts             # GET /health/live and GET /health/ready
│   │   ├── images.ts             # GET /v1/supplier-images/:file
│   │   ├── internal.ts           # GET /v1/internal/suppliers/:id/validate (for order-service)
│   │   └── suppliers.ts          # Public catalog & Admin CRUD endpoints
│   ├── schemas/
│   │   └── supplier.ts           # Zod validation schemas
│   └── utils/
│       └── time.ts               # Real-time Singapore operating hours calculator
└── test/
    ├── demo.test.ts              # Automated CLI demonstration suite
    ├── integration/
    │   ├── admin.test.ts         # Admin CRUD, duplicate name 409, bulk delete
    │   ├── auth.test.ts          # JWKS verification, RBAC, 503 fail-closed
    │   ├── catalog.test.ts       # Search, filter, sorting, pagination, open_now
    │   ├── helpers.ts            # createTestApp helper
    │   ├── internal.test.ts      # Machine-to-machine validation endpoint tests
    │   └── public-routes.test.ts # Health probes & image delivery
    └── unit/
        ├── migrate.test.ts       # Database migration runner unit tests
        ├── rpcConsumer.test.ts   # RabbitMQ Direct Reply-To RPC consumer unit tests
        ├── schemas.test.ts       # Strict Zod validation & tags rejection
        ├── seed-parser.test.ts   # Seed CSV parsing
        ├── seed.test.ts          # Idempotent seeding unit tests
        └── time.test.ts          # Real-time open status logic
```

---

## 4. Verification Commands

```bash
cd supplier-service

# 1. Run all 84 automated unit & integration tests
npm test

# 2. Verify TypeScript builds without errors
npm run build

# 3. Run automated demo CLI
npm run demo

# 4. Run interactive TUI demo (persona toggling, manual keypresses)
npm run demo:interactive

# 5. Build isolated Docker container from scratch (<2s)
docker build --no-cache -t supplier-service:test .
```

---

## 5. Monorepo & Inter-Service Guidance

1. **Shared Packages (`packages/`)**:
   * `@foc/shared-events` (RabbitMQ outbox) and `@foc/shared-middleware` (auth/errors) remain in `packages/` for fast local development.
   * `supplier-service` is self-contained and communicates over HTTP REST (`GET /v1/internal/suppliers/:id/validate`).
2. **Root Lockfile Maintenance**:
   * If teammates update dependencies in sibling services and Docker builds show missing lockfile packages, run once at repo root:
     ```bash
     npm install --package-lock-only
     ```
3. **Guard Against PR #8 Regression**:
   * In Malcolm's PR #8 (`feat/order-service`), verify that `supplier-service/Dockerfile` retains its isolated build context and does not re-add copies of sibling folders.
