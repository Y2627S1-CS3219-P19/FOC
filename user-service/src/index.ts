import { fileURLToPath } from 'node:url';
import { startOutboxRelay, EXCHANGES } from '@foc/shared-events';
import { createAuthenticator, createLogger, runMigrations } from '@foc/shared-middleware';
import { createApp } from './app.js';
import { runAdminBootstrapWithRetry } from './bootstrap.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { createPool } from './db.js';
import { KeycloakAdmin } from './keycloak.js';
import { createSessionChecker } from './sessions.js';

export function buildContext(config = loadConfig()): AppContext {
  const logger = createLogger('user-service', config.logLevel);
  const pool = createPool(config.databaseUrl);
  const kc = new KeycloakAdmin(config.keycloak, logger);
  const auth = createAuthenticator({
    issuer: `${config.keycloak.publicUrl}/realms/${config.keycloak.realm}`,
    jwksUrl: `${config.keycloak.internalUrl}/realms/${config.keycloak.realm}/protocol/openid-connect/certs`,
    allowedClients: config.allowedTokenClients,
  });
  const sessions = createSessionChecker({ kc, pool, config });
  return { config, pool, kc, auth, sessions, logger };
}

async function main() {
  const ctx = buildContext();
  const { config, logger, pool } = ctx;

  await runMigrations(pool, fileURLToPath(new URL('../migrations', import.meta.url)), logger);
  await runAdminBootstrapWithRetry(ctx);

  const relay = config.amqpUrl
    ? startOutboxRelay({
        pool,
        amqpUrl: config.amqpUrl,
        exchanges: [EXCHANGES.user],
        logger,
        debugQueue: config.debugEventQueue ? 'debug.all-user-events' : undefined,
      })
    : null;
  if (!relay) logger.warn('AMQP_URL not set: events stay in outbox_events and are not published');

  const server = createApp(ctx).listen(config.port, () => logger.info({ port: config.port }, 'User Service listening'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    await relay?.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
