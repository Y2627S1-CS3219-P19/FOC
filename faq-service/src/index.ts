import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createAuthenticator, createLogger, runMigrations } from '@foc/shared-middleware';
import type { Logger } from 'pino';
import { createApp } from './app.js';
import { createVectorStore } from './chroma.js';
import { loadConfig } from './config.js';
import { loadCorpusEntries } from './corpus.js';
import { createPool } from './db.js';
import type { AppContext, KbStatus } from './context.js';
import { createChatModel, createEmbeddings } from './modelClient.js';
import { ingestWithRetry } from './ingest.js';
import { storeRetriever } from './retrieval.js';
import { SqlTicketStore } from './sqlTickets.js';

export async function buildContext(config = loadConfig()): Promise<AppContext> {
  const logger: Logger = createLogger('faq-service', config.logLevel);
  const auth = createAuthenticator({
    issuer: `${config.keycloak.publicUrl}/realms/${config.keycloak.realm}`,
    jwksUrl: `${config.keycloak.internalUrl}/realms/${config.keycloak.realm}/protocol/openid-connect/certs`,
    allowedClients: config.keycloak.allowedTokenClients,
  });
  const store = createVectorStore(config, createEmbeddings(config));
  const chat = createChatModel(config);
  const pool = createPool(config.databaseUrl);
  await runMigrations(pool, fileURLToPath(new URL('../migrations', import.meta.url)), logger);
  const kb: KbStatus = { ready: false, chunks: 0 };
  // Ingest on every boot, like supplier-service seeds its database (deterministic chunk ids make
  // the upsert a no-op when nothing changed). Fatal on failure, matching every other service: a
  // restart cannot fix a bad key or a bad corpus, so the deploy must roll back rather than serve
  // a FAQ that refuses every question.
  try {
    const chunks = await ingestWithRetry(store, join(import.meta.dirname, '..', 'corpus'), { logger });
    kb.ready = true;
    kb.chunks = chunks;
    logger.info({ chunks, collection: config.collection }, 'Corpus ingested');
  } catch (err) {
    kb.reason = 'INGEST_FAILED';
    logger.error({ err }, 'Corpus ingestion failed after retries — refusing to start');
    throw err;
  }
  const generate = async (prompt: string): Promise<string> => {
    const res = await chat.invoke(prompt);
    return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
  };
  return {
    config,
    logger,
    auth,
    retrieve: storeRetriever(store),
    generate,
    countStore: () => store.count(),
    kb,
    tickets: new SqlTicketStore(pool, logger),
    listEntries: async () => loadCorpusEntries(join(import.meta.dirname, '..', 'corpus')),
  };
}

async function main() {
  const ctx = await buildContext();
  const server = createApp(ctx).listen(ctx.config.port, () =>
    ctx.logger.info({ port: ctx.config.port }, 'FAQ Service listening'),
  );

  const shutdown = (signal: string) => {
    ctx.logger.info({ signal }, 'Shutting down');
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
