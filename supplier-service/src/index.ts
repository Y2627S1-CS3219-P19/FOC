import dotenv from 'dotenv';
import { buildApp } from './app.js';
import { createDb } from './db/connection.js';
import { DrizzleSupplierRepository } from './db/drizzleRepository.js';
import { runMigrations } from './db/migrate.js';
import { runSeed } from './db/seed.js';

dotenv.config();

const port = Number(process.env.PORT ?? 3002);
const host = '0.0.0.0';

async function main() {
  const { client, db } = createDb();

  // Test DB connection readiness
  let isDbReady = false;
  try {
    await client`SELECT 1`;
    isDbReady = true;
    console.log('Connected to PostgreSQL successfully.');

    await runMigrations(db);
    await runSeed(db);
  } catch (err) {
    console.error('Database connection or initialization error:', err);
  }

  const repository = new DrizzleSupplierRepository(db);

  const app = await buildApp({
    dbReady: isDbReady,
    repository,
    imagesDir: process.env.IMAGES_DIR,
    authConfig: {
      issuer: process.env.KEYCLOAK_PUBLIC_URL
        ? `${process.env.KEYCLOAK_PUBLIC_URL}/realms/${process.env.KEYCLOAK_REALM ?? 'campuserrand'}`
        : 'http://localhost:8080/realms/campuserrand',
      jwksUri: process.env.KEYCLOAK_INTERNAL_URL
        ? `${process.env.KEYCLOAK_INTERNAL_URL}/realms/${process.env.KEYCLOAK_REALM ?? 'campuserrand'}/protocol/openid-connect/certs`
        : undefined,
      userServiceUrl: process.env.USER_SERVICE_URL ?? 'http://user-service:3001',
      internalAuthSecret: process.env.INTERNAL_AUTH_SECRET,
    },
  });

  try {
    await app.listen({ port, host });
    console.log(`Supplier Service listening at http://${host}:${port}`);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }

  const shutdown = async () => {
    console.log('Gracefully shutting down Supplier Service...');
    await app.close();
    await client.end();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
