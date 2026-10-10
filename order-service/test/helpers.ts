import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { RequestHandler } from 'express';
import { createLogger, runMigrations, unauthorized, type Authenticator } from '@foc/shared-middleware';
import type { SupplierCheck, SupplierSnapshot } from '../src/clients/supplierClient.js';
import type { UserSummary } from '../src/clients/userClient.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { buildContext } from '../src/index.js';

// Needs only Postgres, e.g. the orders-sql-test container on port 5436.
const ADMIN_URL = process.env.ORDERS_TEST_ADMIN_URL ?? 'postgres://postgres:test@localhost:5436/postgres';
const TEST_DB = 'orders_test';

export const SUSPENDED_USER = '99999999-0000-0000-0000-000000000099';

/** Fake auth: the caller is whoever is in x-test-user, with roles from x-test-roles. */
const fakeAuth: Authenticator = {
  verify: () => Promise.reject(new Error('not used in tests')),
  requireAuth: ((req, _res, next) => {
    const userId = req.header('x-test-user');
    if (!userId) return next(unauthorized('TOKEN_MISSING', 'Please log in to continue.'));
    const roles = (req.header('x-test-roles') ?? 'user').split(',');
    req.auth = { userId, roles, emailVerified: true, token: `test-${userId}` };
    next();
  }) as RequestHandler,
};

export const supplier: SupplierSnapshot = {
  id: '5a5a5a5a-0000-0000-0000-000000000001',
  name: 'Cool Spot',
  facilityType: 'Food',
  building: 'Com2',
  floor: '1',
  locationDescription: 'Opp LT16',
};

/** Knobs the tests turn to make the other services behave differently. */
export const fakes = {
  supplierCheck: { valid: true, supplier } as SupplierCheck,
  users: new Map<string, UserSummary>(),
  reset() {
    this.supplierCheck = { valid: true, supplier };
    this.users = new Map();
  },
};

let dbRecreated = false;

/** Recreates the test database once per run, so it always matches the current migrations. */
export async function createTestContext(): Promise<AppContext> {
  if (!dbRecreated) {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    dbRecreated = true;
  }

  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  const logger = createLogger('order-service-test', 'silent');
  const ctx = buildContext(
    loadConfig({ DATABASE_URL: url.toString(), INTERNAL_AUTH_SECRET: 'test-secret-123', LOG_LEVEL: 'silent' }),
    {
      logger,
      auth: fakeAuth,
      sessions: async (auth) =>
        auth.userId === SUSPENDED_USER ? { active: true, status: 'suspended' } : { active: true, status: 'active' },
      clients: {
        supplier: { validate: async () => fakes.supplierCheck },
        user: { summary: async (id) => fakes.users.get(id) ?? null },
      },
    },
  );
  await runMigrations(ctx.pool, fileURLToPath(new URL('../migrations', import.meta.url)), logger);
  return ctx;
}

export async function resetDb(ctx: AppContext) {
  await ctx.pool.query('TRUNCATE orders, order_status_history, outbox_events, processed_events');
  fakes.reset();
}

export const as = (userId: string, roles = 'user') => ({ 'x-test-user': userId, 'x-test-roles': roles });

export const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** Inserts an order straight into the DB, for read tests that need a given state. */
export async function insertOrder(
  ctx: AppContext,
  o: {
    requesterId: string;
    runnerId?: string | null;
    status?: string;
    creditAmount?: number;
    building?: string;
    facilityType?: string;
    deliveryLocation?: string;
    expiresInMinutes?: number;
    createdMinutesAgo?: number;
  },
): Promise<string> {
  const id = randomUUID();
  const status = o.status ?? 'OPEN';
  const delivered = status === 'DELIVERED' || status === 'COMPLETED';
  const mins = o.expiresInMinutes ?? 120;
  await ctx.pool.query(
    `INSERT INTO orders (id, requester_id, runner_id, supplier_id, supplier_name, supplier_facility_type, supplier_building,
                         delivery_location, items, credit_amount, status, created_at, expires_at, delivered_at)
     VALUES ($1, $2, $3, $4, 'Cool Spot', $5, $6, $7, '["1x chicken rice"]', $8, $9,
             now() - make_interval(mins => $12), now() + make_interval(mins => $10), CASE WHEN $11 THEN now() END)`,
    [
      id,
      o.requesterId,
      o.runnerId ?? null,
      supplier.id,
      o.facilityType ?? 'Food',
      o.building ?? 'Com2',
      o.deliveryLocation ?? 'COM1 lobby',
      o.creditAmount ?? 5,
      status,
      mins,
      delivered,
      o.createdMinutesAgo ?? 120,
    ],
  );
  return id;
}
