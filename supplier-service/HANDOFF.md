# Handoff Document: Supplier Service Backend Implementation (v0 Complete)

## 1. Context & Branch State
* **Branch**: `feat/supplier-service-v0`
* **Service Folder**: [`supplier-service/`](file:///Users/keaharvan/Documents/University/y4s1/cs3219/FOC/supplier-service/)
* **Service Ownership**: Supplier Service owner
* **Status**: Complete production-ready implementation developed test-first (TDD) adhering 100% to [`openapi.yaml`](./openapi.yaml).

---

## 2. Key Architecture & Technology Choices

| Area | Technology / Choice | Rationale |
| :--- | :--- | :--- |
| **Runtime & Framework** | Node.js 22 + TypeScript + **Fastify 5** | High-performance, schema-driven, native JSON serialization |
| **Database & ORM** | PostgreSQL 16 (`suppliers_db`) + **Drizzle ORM** | Type-safe SQL builder, migrations, and clean schema definition |
| **Normalization** | **Strict Third Normal Form (3NF)** with **Zero Tags** | Atomic scalar columns; `"tags"` strictly rejected with `422 VALIDATION_ERROR` |
| **Image URLs** | Stored as full URL strings in `image_url` | Designed for external / S3 URLs; CSV URLs preserved |
| **Public Assets** | `GET /v1/supplier-images/:file` via `@fastify/static` | Static image delivery from `data/images/` without requiring auth headers |
| **Authentication** | Two-tier: Keycloak JWKS + User Service Introspect | JWKS verification via `jose`, 5s cached introspection with fail-closed (`503`) |
| **Testing** | **Vitest** (Unit & Integration) | 58 passing tests covering 7 vertical TDD slices |

---

## 3. Directory Layout

```text
supplier-service/
├── .env.example                # Config placeholders (DATABASE_URL, KEYCLOAK, USER_SERVICE_URL)
├── Dockerfile                  # Multi-stage production container build
├── README.md                   # Full developer guide, API docs & traceability matrix
├── HANDOFF.md                  # This handoff document
├── drizzle.config.ts           # Drizzle Kit configuration
├── migrations/
│   └── 0000_gifted_hercules.sql# Generated initial 3NF migration with indexes
├── package.json                # Dependencies, devDependencies, and npm scripts
├── tsconfig.json               # TypeScript ES2022 NodeNext configuration
├── vitest.config.ts            # Vitest runner configuration
├── src/
│   ├── app.ts                  # Fastify buildApp factory
│   ├── index.ts                # Server entry point with graceful shutdown
│   ├── db/
│   │   ├── connection.ts       # PostgreSQL client & Drizzle DB instance
│   │   ├── drizzleRepository.ts# Production PostgreSQL repository implementation
│   │   ├── migrate.ts          # Standalone migration runner (npm run db:migrate)
│   │   ├── repository.ts       # SupplierRepository interface & InMemory repository
│   │   ├── schema.ts           # 3NF Drizzle table definition
│   │   ├── seed.ts             # Standalone seed runner (npm run db:seed)
│   │   └── seedParser.ts       # Pure CSV parser converting hours & URLs
│   ├── middleware/
│   │   ├── auth.ts             # Keycloak JWKS + User Service session introspection
│   │   └── errors.ts           # FoC standard error envelope and AppError classes
│   ├── routes/
│   │   ├── health.ts           # GET /health/live and GET /health/ready
│   │   ├── images.ts           # GET /v1/supplier-images/:file
│   │   └── suppliers.ts        # GET, POST, PATCH, DELETE supplier endpoints
│   ├── schemas/
│   │   └── supplier.ts         # Zod schemas rejecting tags with 422
│   └── utils/
│       └── time.ts             # isOpenNow Singapore time calculation
└── test/
    ├── integration/
    │   ├── admin.test.ts       # Slice 7: Admin CRUD, duplicate name 409, bulk delete
    │   ├── auth.test.ts        # Slice 5: JWKS verification, RBAC, 503 fail-closed
    │   ├── catalog.test.ts     # Slice 6: Search, filter, sorting, pagination, open_now
    │   ├── helpers.ts          # createTestApp helper
    │   └── public-routes.test.ts # Slice 4: Health probes & image delivery
    └── unit/
        ├── schemas.test.ts     # Slice 3: Strict Zod validation & tags rejection
        ├── seed-parser.test.ts # Slice 2: Seed CSV parsing
        └── time.test.ts        # Slice 1: Real-time open status
```

---

## 4. Verification Commands

```bash
cd supplier-service

# 1. Run all 58 automated unit & integration tests
npm test

# 2. Verify TypeScript builds without errors
npm run build

# 3. Generate migrations / apply migrations (with local Postgres)
npm run db:generate
npm run db:migrate

# 4. Seed the 21 campus stalls
npm run db:seed
```

---

## 5. Next Steps for Upcoming Sessions

1. **Commit & Push to Remote**:
   - Stage and commit the `supplier-service/` changes on branch `feat/supplier-service-v0`.
   - Push to `origin/feat/supplier-service-v0`.
2. **Docker Compose & Gateway Integration**:
   - Align `compose.yaml` with the team when upstream PR #3 merges, mapping `suppliers-db` on port 5434 and `supplier-service` on port 3002.
3. **Frontend Coordination**:
   - Note for Gabriel / frontend: ensure the frontend form does not send `tags` or removes the tags input to match the clean 3NF contract.
