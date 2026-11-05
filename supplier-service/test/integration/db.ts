import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema.js';
import { runMigrations } from '../../src/db/migrate.js';

/**
 * Admin connection for the local Postgres, e.g.
 *   SUPPLIERS_TEST_ADMIN_URL=postgres://suppliers:<pw>@localhost:5434/postgres
 * The suite skips when it is unset, so `npm test` works without Docker.
 */
const ADMIN_URL = process.env.SUPPLIERS_TEST_ADMIN_URL;
const TEST_DB = 'suppliers_test';

/** True when a database is available for the repository tests. */
export const hasTestDb = Boolean(ADMIN_URL);

let recreated = false;

export async function createTestDb() {
  if (!ADMIN_URL) {
    throw new Error('SUPPLIERS_TEST_ADMIN_URL is not set');
  }

  if (!recreated) {
    const admin = postgres(ADMIN_URL, { max: 1 });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    recreated = true;
  }

  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  const client = postgres(url.toString(), { max: 1 });
  const db = drizzle(client, { schema });
  await runMigrations(db);
  return { client, db };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export async function resetDb(client: TestDb['client']) {
  await client`TRUNCATE suppliers`;
}
