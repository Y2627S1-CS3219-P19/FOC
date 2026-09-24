import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './connection.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  console.log('Running database migrations...');
  const { client, db } = createDb();
  try {
    const migrationsFolder = path.resolve(__dirname, '../../migrations');
    await migrate(db, { migrationsFolder });
    console.log('Database migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
