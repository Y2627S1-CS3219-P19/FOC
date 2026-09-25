import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from '@foc/shared-middleware';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { buildContext } from '../src/index.js';
import { provisionUser } from '../src/provisioning.js';
import type { Role } from '../src/users.js';

/** Reads the repo-root .env so tests use the same secrets as the running Keycloak. */
function readRootEnv(): Record<string, string> {
  const text = readFileSync(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

export const rootEnv = readRootEnv();
export const KEYCLOAK = 'http://localhost:8080';
export const REALM = 'campuserrand';
const TEST_DB = 'users_test';

async function ensureTestDatabase() {
  const admin = new pg.Client({ connectionString: `postgres://users:${rootEnv.USERS_DB_PASSWORD}@localhost:5433/users_db` });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
  if (!rowCount) await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
}

export async function createTestContext(overrides: Record<string, string> = {}): Promise<AppContext> {
  await ensureTestDatabase();
  const config = loadConfig({
    DATABASE_URL: `postgres://users:${rootEnv.USERS_DB_PASSWORD}@localhost:5433/${TEST_DB}`,
    KEYCLOAK_INTERNAL_URL: KEYCLOAK,
    KEYCLOAK_PUBLIC_URL: KEYCLOAK,
    KC_USER_SERVICE_CLIENT_SECRET: rootEnv.KC_USER_SERVICE_CLIENT_SECRET!,
    INTERNAL_AUTH_SECRET: rootEnv.INTERNAL_AUTH_SECRET!,
    ADMIN_CONTACT_EMAIL: 'foc-admin@u.nus.edu',
    REGISTER_RATE_LIMIT_PER_HOUR: '100000',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
  const ctx = buildContext(config);
  await runMigrations(ctx.pool, fileURLToPath(new URL('../migrations', import.meta.url)), ctx.logger);
  return ctx;
}

/** Wipe all User Service tables (TRUNCATE does not fire the audit log's row-level immutability trigger). */
export async function resetDatabase(ctx: AppContext) {
  await ctx.pool.query('TRUNCATE role_change_requests, admin_audit_log, outbox_events, system_state, users CASCADE');
}

export const app = (ctx: AppContext) => createApp(ctx);

export const uniq = (prefix = 't') => `${prefix}_${randomBytes(4).toString('hex')}`;
export const PASSWORD = 'Password1';

/** Keycloak ids created by tests, deleted in cleanup(). */
const created = new Set<string>();
export const track = (id: string) => created.add(id);

export async function cleanup(ctx: AppContext) {
  for (const id of created) await ctx.kc.deleteUser(id).catch(() => undefined);
  created.clear();
  await ctx.pool.end();
}

export interface TestUser {
  id: string;
  username: string;
  email: string;
  token: string;
}

export async function passwordToken(username: string, password = PASSWORD): Promise<string> {
  const res = await fetch(`${KEYCLOAK}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'campuserrand-test', username, password }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) throw new Error(`Login failed for ${username}: ${body.error_description}`);
  return body.access_token;
}

/** A verified account created through the normal provisioning path, plus a fresh access token. */
export async function makeUser(ctx: AppContext, role: Role = 'user'): Promise<TestUser> {
  const username = uniq(role === 'admin' ? 'tadmin' : 'tuser');
  const email = `${username}@u.nus.edu`;
  const user = await provisionUser(ctx, {
    username,
    email,
    password: PASSWORD,
    role,
    temporaryPassword: false,
    emailVerified: true,
    sendVerificationEmail: false,
  });
  track(user.id);
  return { id: user.id, username, email, token: await passwordToken(username) };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
