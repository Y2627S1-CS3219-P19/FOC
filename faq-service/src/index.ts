import { fileURLToPath } from 'node:url';
import { createAuthenticator, createLogger } from '@foc/shared-middleware';
import type { Logger } from 'pino';
import { createApp } from './app.js';
import { createVectorStore } from './chroma.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { createChatModel, createEmbeddings } from './modelClient.js';
import { storeRetriever } from './retrieval.js';

export function buildContext(config = loadConfig()): AppContext {
  const logger: Logger = createLogger('faq-service', config.logLevel);
  const auth = createAuthenticator({
    issuer: `${config.keycloak.publicUrl}/realms/${config.keycloak.realm}`,
    jwksUrl: `${config.keycloak.internalUrl}/realms/${config.keycloak.realm}/protocol/openid-connect/certs`,
    allowedClients: config.keycloak.allowedTokenClients,
  });
  const store = createVectorStore(config, createEmbeddings(config));
  const chat = createChatModel(config);
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
    pingStore: () => store.ping(),
  };
}

async function main() {
  const ctx = buildContext();
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
