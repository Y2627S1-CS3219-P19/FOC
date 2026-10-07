import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './connection.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(dbInstance?: ReturnType<typeof createDb>['db']) {
  console.log('Running database migrations...');
  const shouldClose = !dbInstance;
  let clientToClose: ReturnType<typeof createDb>['client'] | null = null;
  let db = dbInstance;

  if (!db) {
    const conn = createDb();
    clientToClose = conn.client;
    db = conn.db;
  }

  try {
    const migrationsFolder = path.resolve(__dirname, '../../migrations');
    await migrate(db, { migrationsFolder });
    console.log('Database migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    if (shouldClose && clientToClose) {
      await clientToClose.end();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations().catch(() => process.exit(1));
}
