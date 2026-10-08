import { fileURLToPath } from 'node:url';
import { EXCHANGES, startOutboxRelay } from '@foc/shared-events';
import {
  cachedSessionChecker,
  createAuthenticator,
  createLogger,
  remoteSessionChecker,
  runMigrations,
} from '@foc/shared-middleware';
import { createApp } from './app.js';
import { createSupplierClient } from './clients/supplierClient.js';
import { createUserClient } from './clients/userClient.js';
import { loadConfig, type Config } from './config.js';
import type { AppContext } from './context.js';
import { createPool } from './db.js';
import { startCreditConsumer } from './events/creditConsumer.js';
import { startSweepers } from './jobs/sweepers.js';

/** Tests pass overrides to swap in fake auth, sessions or clients. */
export function buildContext(config: Config = loadConfig(), overrides: Partial<AppContext> = {}): AppContext {
  const logger = overrides.logger ?? createLogger('order-service', config.logLevel);
  const http = { secret: config.internalAuthSecret, timeoutMs: config.httpTimeoutMs };
  return {
    config,
    logger,
    pool: createPool(config.databaseUrl),
    auth: createAuthenticator({
      issuer: `${config.keycloak.publicUrl}/realms/${config.keycloak.realm}`,
      jwksUrl: `${config.keycloak.internalUrl}/realms/${config.keycloak.realm}/protocol/openid-connect/certs`,
      allowedClients: config.allowedTokenClients,
    }),
    sessions: cachedSessionChecker(remoteSessionChecker(config.userServiceUrl, config.internalAuthSecret)),
    clients: {
      supplier: createSupplierClient({ ...http, baseUrl: config.supplierServiceUrl }),
      user: createUserClient({ ...http, baseUrl: config.userServiceUrl }, logger),
    },
    ...overrides,
  };
}

async function main() {
  const ctx = buildContext();
  const { config, logger, pool } = ctx;

  await runMigrations(pool, fileURLToPath(new URL('../migrations', import.meta.url)), logger);

  const relay = config.amqpUrl
    ? startOutboxRelay({
        pool,
        amqpUrl: config.amqpUrl,
        exchanges: [EXCHANGES.order],
        logger,
        debugQueue: config.debugEventQueue ? 'debug.all-order-events' : undefined,
      })
    : null;
  const consumer = config.amqpUrl ? startCreditConsumer({ pool, amqpUrl: config.amqpUrl, logger }) : null;
  if (!config.amqpUrl) logger.warn('AMQP_URL not set: events stay in outbox_events and credit replies are not consumed');
  const sweepers = startSweepers({
    pool,
    logger,
    intervalMs: config.expirySweepMs,
    autoConfirmAfterHours: config.autoConfirmAfterHours,
    pendingTimeoutSeconds: config.pendingTimeoutSeconds,
  });

  const server = createApp(ctx).listen(config.port, () => logger.info({ port: config.port }, 'Order Service listening'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    sweepers.stop();
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
