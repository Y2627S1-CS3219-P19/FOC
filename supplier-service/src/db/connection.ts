import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export function createDb(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL ?? 'postgres://suppliers:suppliers_password@localhost:5434/suppliers_db';
  const client = postgres(url, { max: 10 });
  const db = drizzle(client, { schema });
  return { client, db };
}
