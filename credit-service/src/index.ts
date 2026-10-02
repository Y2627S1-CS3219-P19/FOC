import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { startOutboxRelay, EXCHANGES } from '@foc/shared-events';
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
import { startEventConsumer } from './consumer.js';

export function buildContext(config = loadConfig()): AppContext {
  const logger = createLogger('credit-service', config.logLevel);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
  const auth = createAuthenticator({
    issuer: `${config.keycloak.publicUrl}/realms/${config.keycloak.realm}`,
    jwksUrl: `${config.keycloak.internalUrl}/realms/${config.keycloak.realm}/protocol/openid-connect/certs`,
    allowedClients: config.allowedTokenClients,
  });
  const sessions = cachedSessionChecker(remoteSessionChecker(config.userServiceUrl, config.internalAuthSecret));
  return { config, pool, auth, sessions, logger };
}

async function main() {
  const ctx = buildContext();
  const { config, logger, pool } = ctx;

  await runMigrations(pool, fileURLToPath(new URL('../migrations', import.meta.url)), logger);

  // Producer: outbox relay for credit.events
  const relay = config.amqpUrl
    ? startOutboxRelay({
        pool,
        amqpUrl: config.amqpUrl,
        exchanges: [EXCHANGES.credit],
        logger,
        debugQueue: config.debugEventQueue ? 'debug.all-credit-events' : undefined,
      })
    : null;
  if (!relay) logger.warn('AMQP_URL not set: events stay in outbox_events and are not published');

  // Consumer: subscribe to user.events and order.events
  const consumer = config.amqpUrl
    ? startEventConsumer({ pool, amqpUrl: config.amqpUrl, logger, initialCreditBalance: config.initialCreditBalance })
    : null;
  if (!consumer) logger.warn('AMQP_URL not set: not consuming events');

  const server = createApp(ctx).listen(config.port, () =>
    logger.info({ port: config.port }, 'Credit Service listening'),
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    await consumer?.stop();
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
