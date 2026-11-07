import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document } from '@langchain/core/documents';
import { chunkIds, ingestCorpus, loadCorpusDocs } from '../src/ingest.js';
import type { FaqStore } from '../src/chroma.js';

/** Records the ids it was given, like the Chroma store upserts by id. */
class SpyStore implements FaqStore {
  lastDocs: Document[] = [];
  lastIds: string[] | undefined;
  async addDocuments(documents: Document[], options?: { ids?: string[] }): Promise<void> {
    this.lastDocs = documents;
    this.lastIds = options?.ids;
  }
  async similaritySearchWithScore(): Promise<[Document, number][]> {
    return [];
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
});
