import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg, { type PoolClient } from 'pg';
import pino from 'pino';
import { runMigrations } from '@foc/shared-middleware';
import type { AppContext } from '../src/context.js';
import { createApp } from '../src/app.js';
import type { RequestHandler } from 'express';

/** Reads the repo-root .env so tests use the same DB password as docker compose. */
function readRootEnv(): Record<string, string> {
  const text = readFileSync(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

const rootEnv = readRootEnv();
const TEST_DB = 'credits_test';
const INTERNAL_SECRET = rootEnv.INTERNAL_AUTH_SECRET ?? 'test-internal-secret';

async function ensureTestDatabase() {
  const admin = new pg.Client({
    connectionString: `postgres://credits:${rootEnv.CREDITS_DB_PASSWORD}@localhost:5435/credits_db`,
  });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
  if (!rowCount) await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
}

/** User id that the mocked auth middleware injects by default. */
export const TEST_USER_ID = '00000000-0000-4000-a000-000000000001';
export const TEST_ADMIN_ID = '00000000-0000-4000-a000-000000000002';
export const TEST_RUNNER_ID = '00000000-0000-4000-a000-000000000003';

/**
 * Build an AppContext with a real pg pool but mocked auth.
 * `defaultUserId` and `defaultRoles` control what the stubbed auth middleware injects.
 */
export async function createTestContext(
  defaultUserId = TEST_USER_ID,
  defaultRoles: string[] = ['user'],
): Promise<AppContext> {
  await ensureTestDatabase();

  const pool = new pg.Pool({
    connectionString: `postgres://credits:${rootEnv.CREDITS_DB_PASSWORD}@localhost:5435/${TEST_DB}`,
    max: 5,
  });

  const logger = pino({ level: 'silent' });

  await runMigrations(pool, fileURLToPath(new URL('../migrations', import.meta.url)), logger);

  // Stub auth: injects req.auth without verifying a real JWT.
  const requireAuth: RequestHandler = (req, _res, next) => {
    req.auth = {
      userId: defaultUserId,
      roles: defaultRoles,
      emailVerified: true,
      token: 'fake-token',
    };
    next();
  };

  const auth = {
    verify: async () => ({ userId: defaultUserId, roles: defaultRoles, emailVerified: true, token: 'fake-token' }),
    requireAuth,
  };

  // Stub session checker: always active.
  const sessions = async () => ({ active: true, status: 'active' as const });

  return {
    config: {
      port: 0,
      logLevel: 'silent',
      databaseUrl: `postgres://credits:${rootEnv.CREDITS_DB_PASSWORD}@localhost:5435/${TEST_DB}`,
      keycloak: { internalUrl: 'http://localhost:8080', publicUrl: 'http://localhost:8080', realm: 'campuserrand' },
      allowedTokenClients: ['campuserrand-test'],
      userServiceUrl: 'http://localhost:3001',
      internalAuthSecret: INTERNAL_SECRET,
      amqpUrl: '',
      debugEventQueue: false,
      initialCreditBalance: 100,
      trustProxy: false,
    },
    pool,
    auth: auth as unknown as AppContext['auth'],
    sessions,
    logger,
  };
}

/** TRUNCATE all tables (resets data between tests). */
export async function resetDatabase(ctx: AppContext) {
  await ctx.pool.query('TRUNCATE ledger, reservations, wallets, processed_events, outbox_events, system_state CASCADE');
}

/** Insert a wallet with a given balance + an ISSUANCE ledger entry. */
export async function seedWallet(client: PoolClient, userId: string, balance: number) {
  await client.query(
    'INSERT INTO wallets (user_id, available_balance, reserved_balance) VALUES ($1, $2, 0)',
    [userId, balance],
  );
  await client.query(
    `INSERT INTO ledger (id, user_id, reservation_id, type, amount, balance_after)
     VALUES ($1, $2, NULL, 'ISSUANCE', $3, $3)`,
    [randomUUID(), userId, balance],
  );
}

/** Seed a wallet using the pool directly (convenience for route tests). */
export async function seedWalletFromPool(ctx: AppContext, userId: string, balance: number) {
  const client = await ctx.pool.connect();
  try {
    await seedWallet(client, userId, balance);
  } finally {
    client.release();
  }
}

/** Create the Express app for supertest. */
export const testApp = (ctx: AppContext) => createApp(ctx);

export const INTERNAL_AUTH_HEADER = { 'X-Internal-Auth': INTERNAL_SECRET };

export async function cleanup(ctx: AppContext) {
  await ctx.pool.end();
}
