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
