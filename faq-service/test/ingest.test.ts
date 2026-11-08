import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document } from '@langchain/core/documents';
import { chunkIds, ingestCorpus, ingestWithRetry, loadCorpusDocs } from '../src/ingest.js';
import type { FaqStore } from '../src/chroma.js';

/** Records the ids it was given, like the Chroma store upserts by id. */
class SpyStore implements FaqStore {
  lastDocs: Document[] = [];
  lastIds: string[] | undefined;
  addCalls = 0;
  countCalls = 0;
  /** How many count() calls should fail before it starts answering (simulates a starting store). */
  countFailures = 0;
  existing = 0;
  async addDocuments(documents: Document[], options?: { ids?: string[] }): Promise<void> {
    this.addCalls++;
    this.lastDocs = documents;
    this.lastIds = options?.ids;
  }
  async similaritySearchWithScore(): Promise<[Document, number][]> {
    return [];
  }
  async count(): Promise<number> {
    this.countCalls++;
    if (this.countCalls <= this.countFailures) throw new Error('chroma not ready');
    return this.existing || this.lastDocs.length;
  }
  async ping(): Promise<void> {}
}

function tempCorpus(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'faq-corpus-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe('ingest', () => {
  it('chunks only .md files, one document per ## heading', () => {
    const dir = tempCorpus({
      'faq.md': '# Title\n\n## Credits\n\nCredits move through errands.\n',
      'notes.txt': '## not a corpus file\n',
    });
    const docs = loadCorpusDocs(dir);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ pageContent: 'Credits move through errands.' });
    expect(docs[0].metadata).toEqual({ source: 'faq.md', heading: 'Credits' });
  });

  it('builds deterministic ids from source and heading slug', () => {
    const docs = [
      new Document({ pageContent: 'x', metadata: { source: 'faq.md', heading: 'What are credits?' } }),
      new Document({ pageContent: 'y', metadata: { source: 'faq.md', heading: 'Errands: the lifecycle' } }),
    ];
    expect(chunkIds(docs)).toEqual(['faq.md#what-are-credits', 'faq.md#errands-the-lifecycle']);
  });

  it('ingests with the deterministic ids so re-running upserts instead of duplicating', async () => {
    const dir = tempCorpus({ 'faq.md': '## A heading\n\nSome body text.\n' });
    const store = new SpyStore();
    const count = await ingestCorpus(store, dir);
    expect(count).toBe(1);
    expect(store.lastIds).toEqual(['faq.md#a-heading']);
  });

  it('can ingest a single corpus file by name', async () => {
    const dir = tempCorpus({
      'a.md': '## From A\n\nBody a.\n',
      'b.md': '## From B\n\nBody b.\n',
    });
    const store = new SpyStore();
    const count = await ingestCorpus(store, dir, 'b.md');
    expect(count).toBe(1);
    expect(store.lastIds).toEqual(['b.md#from-b']);
  });

  it('throws on an empty corpus instead of writing an empty collection', async () => {
    const dir = tempCorpus({});
    const store = new SpyStore();
    await expect(ingestCorpus(store, dir)).rejects.toThrow(/nothing to ingest/i);
  });

  it('retries a store that is still starting, then ingests once', async () => {
    const dir = tempCorpus({ 'faq.md': '## A heading\n\nSome body text.\n' });
    const store = new SpyStore();
    store.countFailures = 2;
    const warnings: string[] = [];
    const chunks = await ingestWithRetry(store, dir, {
      attempts: 3,
      delayMs: 0,
      logger: { warn: (_fields, msg) => warnings.push(msg) },
    });
    expect(chunks).toBe(1);
    expect(store.countCalls).toBe(3);
    expect(store.addCalls).toBe(1);
    expect(warnings).toHaveLength(2);
  });

  it('gives up after the last attempt and throws, so the caller can fail the boot', async () => {
    const dir = tempCorpus({ 'faq.md': '## A heading\n\nSome body text.\n' });
    const store = new SpyStore();
    store.countFailures = 99;
    await expect(
      ingestWithRetry(store, dir, { attempts: 3, delayMs: 0, logger: { warn: () => undefined } }),
    ).rejects.toThrow(/chroma not ready/);
    expect(store.countCalls).toBe(3);
    expect(store.addCalls).toBe(0);
  });

  it('skips re-embedding when the collection already holds the corpus', async () => {
    const dir = tempCorpus({ 'faq.md': '## A heading\n\nSome body text.\n' });
    const store = new SpyStore();
    store.existing = 1; // same count as the corpus
    const infos: string[] = [];
    const chunks = await ingestWithRetry(store, dir, {
      delayMs: 0,
      logger: { info: (_fields, msg) => infos.push(msg), warn: () => undefined },
    });
    expect(chunks).toBe(1);
    expect(store.addCalls).toBe(0); // no embedding calls burned
    expect(infos.join(' ')).toMatch(/skipping/i);
  });

  it('re-ingests when the collection holds a different number of chunks', async () => {
    const dir = tempCorpus({ 'faq.md': '## A heading\n\nSome body text.\n' });
    const store = new SpyStore();
    store.existing = 5;
    await ingestWithRetry(store, dir, { delayMs: 0, logger: { warn: () => undefined } });
    expect(store.addCalls).toBe(1);
  });
});
