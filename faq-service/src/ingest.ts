import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chunkMarkdown, slug } from './corpus.js';
import type { FaqStore } from './chroma.js';

/** The corpus as chunks: one document per `## heading` across every .md file. */
export function loadCorpusDocs(corpusDir: string, onlyFile?: string) {
  const files = onlyFile ? [onlyFile] : readdirSync(corpusDir).filter((f) => f.endsWith('.md'));
  return files.flatMap((file) => chunkMarkdown(file, readFileSync(join(corpusDir, file), 'utf8')));
}

/** Stable ids (source#heading-slug) so re-ingestion upserts instead of duplicating. */
export function chunkIds(docs: { metadata: Record<string, unknown> }[]): string[] {
  return docs.map((d) => `${d.metadata.source}#${slug(d.metadata.heading as string)}`);
}

/**
 * Upserts the corpus into the store. Idempotent: safe on every boot, and after corpus edits.
 * Returns the chunk count. Throws if the corpus is empty or embedding/upsert fails.
 */
export async function ingestCorpus(
  store: FaqStore,
  corpusDir: string,
  onlyFile?: string,
): Promise<number> {
  const docs = loadCorpusDocs(corpusDir, onlyFile);
  if (!docs.length) throw new Error(`nothing to ingest in ${corpusDir}`);
  await store.addDocuments(docs, { ids: chunkIds(docs) });
  return docs.length;
}

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  logger?: {
    info?: (fields: Record<string, unknown>, msg: string) => void;
    warn: (fields: Record<string, unknown>, msg: string) => void;
  };
}

/**
 * Ingest with a bounded retry, skipping the work when the collection already holds the corpus.
 *
 * The store may still be starting when this runs (compose starts Chroma, ECS starts containers
 * concurrently), so waiting is the fix for that race. Ingest is idempotent (deterministic ids), so
 * a retry never duplicates. The count guard stops a restart loop from re-embedding the whole
 * corpus on every boot, which would burn embedding quota for nothing.
 *
 * Throws once every attempt has failed: the caller treats that as fatal, so the platform rolls
 * the deploy back instead of serving refusals to everyone.
 */
export async function ingestWithRetry(
  store: FaqStore,
  corpusDir: string,
  { attempts = 3, delayMs = 5000, logger }: RetryOptions = {},
): Promise<number> {
  const expected = loadCorpusDocs(corpusDir).length;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const existing = await store.count();
      if (existing === expected) {
        logger?.info?.({ chunks: existing }, 'Corpus already ingested, skipping');
        return existing;
      }
      return await ingestCorpus(store, corpusDir);
    } catch (err) {
      lastError = err;
      logger?.warn({ err, attempt, attempts }, 'Corpus ingestion attempt failed');
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
