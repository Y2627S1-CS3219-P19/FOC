import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@foc/shared-middleware';
import { createVectorStore } from '../src/chroma.js';
import { chunkMarkdown, slug } from '../src/corpus.js';
import { createEmbeddings } from '../src/modelClient.js';
import { loadConfig } from '../src/config.js';

/**
 * Chunks the corpus (one document per `## heading`) and upserts it into Chroma with a
 * deterministic id (`source#heading-slug`), so re-running never creates duplicates.
 */

async function main() {
  const config = loadConfig();
  const logger = createLogger('faq-ingest', config.logLevel);
  const corpusDir = join(import.meta.dirname, '..', 'corpus');
  const files = process.argv[2] ? [process.argv[2]] : readdirSync(corpusDir).filter((f) => f.endsWith('.md'));

  const docs = files.flatMap((file) => chunkMarkdown(file, readFileSync(join(corpusDir, file), 'utf8')));
  if (!docs.length) {
    logger.error('No chunks found in corpus — nothing to ingest');
    process.exit(1);
  }

  const store = createVectorStore(config, createEmbeddings(config));
  const vectors = await createEmbeddings(config).embedDocuments(docs.map((d) => d.pageContent));
  const empty = vectors.findIndex((v) => !v.length);
  if (empty >= 0) throw new Error(`embedding failed for chunk ${empty} (${docs[empty].metadata.heading})`);

  // Deterministic ids make ingestion idempotent: Chroma upserts by id.
  const ids = docs.map((d) => `${d.metadata.source}#${slug(d.metadata.heading as string)}`);
  await store.addVectors(vectors, docs, { ids });

  logger.info({ chunks: docs.length, collection: config.collection, files }, 'Ingestion complete');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
