import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@foc/shared-middleware';
import { createVectorStore } from '../src/chroma.js';
import { ingestCorpus } from '../src/ingest.js';
import { loadConfig } from '../src/config.js';

/**
 * Manual one-off ingestion. The service already ingests on every boot (src/index.ts), so this
 * exists only for forcing a single file or running against a remote Chroma. Deterministic chunk
 * ids (source#heading-slug) make re-runs upsert, never duplicate.
 */

async function main() {
  const config = loadConfig();
  const logger = createLogger('faq-ingest', config.logLevel);
  const corpusDir = join(import.meta.dirname, '..', 'corpus');
  const onlyFile = process.argv[2];

  const store = createVectorStore(config, createEmbeddings(config));
  const chunks = await ingestCorpus(store, corpusDir, onlyFile);
  logger.info({ chunks, collection: config.collection, file: onlyFile ?? 'all' }, 'Ingestion complete');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
