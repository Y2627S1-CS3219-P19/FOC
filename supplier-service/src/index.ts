import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  cachedSessionChecker,
  createAuthenticator,
  createLogger,
  remoteSessionChecker,
  runMigrations,
} from '@foc/shared-middleware';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { seedSuppliers } from './seed.js';

export function buildContext(config = loadConfig()): AppContext {
  const logger = createLogger('supplier-service', config.logLevel);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
  const auth = createAuthenticator({
    issuer: `${config.keycloak.publicUrl}/realms/${config.keycloak.realm}`,
    jwksUrl: `${config.keycloak.internalUrl}/realms/${config.keycloak.realm}/protocol/openid-connect/certs`,
    allowedClients: config.allowedTokenClients,
  });
  // Uses the User Service to confirm the session is live and the account not suspended (cached 5s).
  const sessions = cachedSessionChecker(remoteSessionChecker(config.userServiceUrl, config.internalAuthSecret));
  return { config, pool, auth, sessions, logger };
}

async function main() {
  const ctx = buildContext();
  await runMigrations(ctx.pool, fileURLToPath(new URL('../migrations', import.meta.url)), ctx.logger);
  if (ctx.config.seedOnStart) await seedSuppliers(ctx);
  const server = createApp(ctx).listen(ctx.config.port, () => ctx.logger.info({ port: ctx.config.port }, 'Supplier Service listening'));
  const shutdown = async () => {
    server.close();
    await ctx.pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
