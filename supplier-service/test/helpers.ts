import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from '@foc/shared-middleware';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { buildContext } from '../src/index.js';

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
const KEYCLOAK = 'http://localhost:8080';
const REALM = 'campuserrand';
const TEST_DB = 'suppliers_test';
export const PASSWORD = 'Password1';

export async function createTestContext(): Promise<AppContext> {
  const admin = new pg.Client({ connectionString: `postgres://suppliers:${rootEnv.SUPPLIERS_DB_PASSWORD}@localhost:5434/suppliers_db` });
  await admin.connect();
  if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB])).rowCount) await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const ctx = buildContext(
    loadConfig({
      DATABASE_URL: `postgres://suppliers:${rootEnv.SUPPLIERS_DB_PASSWORD}@localhost:5434/${TEST_DB}`,
      KEYCLOAK_INTERNAL_URL: KEYCLOAK,
      KEYCLOAK_PUBLIC_URL: KEYCLOAK,
      USER_SERVICE_URL: 'http://localhost:3001', // the running User Service container
      INTERNAL_AUTH_SECRET: rootEnv.INTERNAL_AUTH_SECRET!,
      LOG_LEVEL: 'silent',
    }),
  );
  await runMigrations(ctx.pool, fileURLToPath(new URL('../migrations', import.meta.url)), ctx.logger);
  await ctx.pool.query('TRUNCATE suppliers, system_state');
  return ctx;
}

export const app = (ctx: AppContext) => createApp(ctx);
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Minimal Keycloak admin calls for test accounts (the real app creates users through the User Service). */
async function serviceToken(): Promise<string> {
  const res = await fetch(`${KEYCLOAK}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'user-service', client_secret: rootEnv.KC_USER_SERVICE_CLIENT_SECRET! }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

const created: string[] = [];

export async function makeUser(role: 'user' | 'admin' = 'user'): Promise<{ id: string; token: string }> {
  const svc = await serviceToken();
  const username = `sup_${role}_${randomBytes(4).toString('hex')}`;
  const res = await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@u.nus.edu`,
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: PASSWORD, temporary: false }],
    }),
  });
  const id = res.headers.get('location')!.split('/').pop()!;
  created.push(id);
  if (role === 'admin') {
    const roleRep = await (await fetch(`${KEYCLOAK}/admin/realms/${REALM}/roles/admin`, { headers: { Authorization: `Bearer ${svc}` } })).json();
    await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users/${id}/role-mappings/realm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([roleRep]),
    });
  }
  const tok = await fetch(`${KEYCLOAK}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'campuserrand-test', username, password: PASSWORD }),
  });
  return { id, token: ((await tok.json()) as { access_token: string }).access_token };
}

export async function logout(id: string) {
  const svc = await serviceToken();
  await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users/${id}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${svc}` } });
}

export async function cleanup(ctx: AppContext) {
  const svc = await serviceToken();
  for (const id of created) {
    await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${svc}` } });
  }
  await ctx.pool.end();
}
