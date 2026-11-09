import { describe, expect, it } from 'vitest';
import { Embeddings } from '@langchain/core/embeddings';
import { Document } from '@langchain/core/documents';
import { ask, buildPrompt } from '../src/faq.js';
import { storeRetriever } from '../src/retrieval.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '@foc/shared-middleware';
import type { FaqStore } from '../src/chroma.js';

/** Deterministic fake: known strings map to fixed vectors, anything unknown maps to a zero vector. */
class FakeEmbeddings extends Embeddings {
  constructor(private map: Map<string, number[]>, private dim = 4) {
    super({});
  }
  private vec(text: string): number[] {
    return this.map.get(text) ?? new Array(this.dim).fill(0);
  }
  async embedQuery(text: string): Promise<number[]> {
    return this.vec(text);
  }
  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vec(t));
  }
}

const DOCS = [
  new Document({
    pageContent: 'Credits cannot be bought, sold or cashed out. They move only through errands.',
    metadata: { source: 'faq.md', heading: 'What are credits?' },
  }),
  new Document({
    pageContent: 'Errands go PENDING, OPEN, ACCEPTED, COLLECTED, DELIVERED, COMPLETED.',
    metadata: { source: 'faq.md', heading: 'What are the stages of an errand?' },
  }),
  new Document({
    pageContent: 'Registration requires an @u.nus.edu email address, verified on the server.',
    metadata: { source: 'faq.md', heading: 'Why do I need a @u.nus.edu email?' },
  }),
];

/** Minimal in-memory FaqStore: cosine over the fake vectors. Same shape as the Chroma store. */
class InMemoryFaqStore implements FaqStore {
  private rows: { vector: number[]; doc: Document }[] = [];
  constructor(private embeddings: Embeddings) {}
  async addDocuments(documents: Document[], options?: { ids?: string[] }): Promise<void> {
    void options;
    for (const doc of documents) {
      this.rows.push({ vector: await this.embeddings.embedQuery(doc.pageContent), doc });
    }
  }
  async similaritySearchWithScore(query: string, k: number): Promise<[Document, number][]> {
    const q = await this.embeddings.embedQuery(query);
    return this.rows
      .map(({ vector, doc }) => {
        const dot = q.reduce((sum, x, i) => sum + x * vector[i], 0);
        const norm = Math.hypot(...q) * Math.hypot(...vector) || 1;
        return [doc, dot / norm] as [Document, number];
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, k);
  }
  async count(): Promise<number> {
    return this.rows.length;
  }
  async ping(): Promise<void> {}
}

async function setup(opts: { floor?: number; answer?: string } = {}) {
  // "credits" question sits exactly on doc 0; "stages" on doc 1; anything else is orthogonal.
  const vectors = new Map<string, number[]>([
    ['credits', [1, 0, 0, 0]],
    [DOCS[0].pageContent, [1, 0, 0, 0]],
    ['stages', [0, 1, 0, 0]],
    [DOCS[1].pageContent, [0, 1, 0, 0]],
    ['email', [0, 0, 1, 0]],
    [DOCS[2].pageContent, [0, 0, 1, 0]],
    ['credit-ish', [0.8, 0.6, 0, 0]], // cosine 0.8 vs the credits chunk — a near, not exact, match
  ]);
  const store: FaqStore = new InMemoryFaqStore(new FakeEmbeddings(vectors));
  await store.addDocuments(DOCS, ['a', 'b', 'c']);
  const retrieve = storeRetriever(store);
  const prompts: string[] = [];
  const config = {
    ...loadConfig({ GEMINI_API_KEY: 'test', OPENROUTER_API_KEY: 'test', FAQ_DATABASE_URL: 'postgres://faq:test@localhost:5438/faq_db' }),
    similarityFloor: opts.floor ?? 0.35,
  };
  const events: Record<string, unknown>[] = [];
  const ctx = {
    config,
    // Spy logger: the ask event is the observability seam, so tests assert on its shape.
    logger: {
      info: (obj: Record<string, unknown>, msg: string) => events.push({ ...obj, msg }),
    } as unknown as ReturnType<typeof createLogger>,
    events,
    retrieve,
    prompts,
    generate: async (prompt: string) => {
      prompts.push(prompt);
      return opts.answer ?? 'Grounded answer [1]';
    },
  };
  return ctx;
}

describe('ask (RAG core, offline with fakes)', () => {
  it('returns a grounded answer with citations when retrieval is confident', async () => {
    const ctx = await setup();
    const res = await ask(ctx, 'credits');
    expect(res.answer).toBe('Grounded answer [1]');
    if (res.answer !== null) {
      expect(res.citations[0]).toMatchObject({ index: 1, source: 'faq.md', heading: 'What are credits?' });
      expect(res.sources).toEqual(['faq.md']);
    } else {
      throw new Error('expected an answer, got a refusal');
    }
  });

  it('retrieves the right chunk as top-1 for each scripted question', async () => {
    const ctx = await setup();
    for (const [question, expected] of [
      ['credits', 'What are credits?'],
      ['stages', 'What are the stages of an errand?'],
      ['email', 'Why do I need a @u.nus.edu email?'],
    ] as const) {
      const res = await ask(ctx, question);
      expect(res.answer).not.toBeNull();
      if (res.answer !== null) expect(res.citations[0].heading).toBe(expected);
    }
  });

  it('refuses with the escalation payload for out-of-corpus questions', async () => {
    const ctx = await setup();
    const res = await ask(ctx, 'quantum physics');
    expect(res.answer).toBeNull();
    // Escalation carries the question, the nearest (low-confidence) topics and who asked.
    expect(res.escalation?.question).toBe('quantum physics');
    // No requester identity in the escalation payload.
    expect(res.escalation).not.toHaveProperty('userId');
    expect(res.escalation!.matchedTopics.length).toBeLessThanOrEqual(4);
    expect(res.suggestions!.length).toBeLessThanOrEqual(3);
  });

  it('refuses a partial match below the floor but answers it above the floor', async () => {
    // 'credit-ish' is a near match (0.8) for the credits chunk, not an exact one.
    const refuseCtx = await setup({ floor: 0.85 });
    expect((await ask(refuseCtx, 'credit-ish')).answer).toBeNull();
    const answerCtx = await setup({ floor: 0.7 });
    expect((await ask(answerCtx, 'credit-ish')).answer).not.toBeNull();
  });

  it('turns an "I do not know" model reply into a refusal', async () => {
    const ctx = await setup({ answer: 'I do not know.' });
    const res = await ask(ctx, 'credits');
    expect(res.answer).toBeNull();
    expect(res.escalation?.question).toBe('credits');
  });

  it('maps cited indexes to the right chunks', async () => {
    const ctx = await setup({ answer: 'See [2] and [1]' });
    const res = await ask(ctx, 'credits');
    if (res.answer === null) throw new Error('expected an answer');
    expect(res.citations.map((c) => c.index)).toEqual([1, 2]);
    expect(res.citations[1].heading).toBe('What are the stages of an errand?');
  });

  it('is deterministic: the same question twice returns byte-identical JSON', async () => {
    const ctx = await setup();
    const a = JSON.stringify(await ask(ctx, 'credits'));
    const b = JSON.stringify(await ask(ctx, 'credits'));
    expect(a).toBe(b);
  });

  it('emits the ask event with quality fields but no user identity', async () => {
    const ctx = await setup();
    await ask(ctx, 'credits');
    const event = ctx.events[0];
    // The CloudWatch metric filters depend on these fields.
    expect(event).toMatchObject({ msg: 'faq ask', refused: false });
    expect(event).toHaveProperty('top1Similarity');
    expect(event).toHaveProperty('durationMs');
    expect(event).toHaveProperty('similarityFloor');
    expect(event).not.toHaveProperty('userId');
  });
});

describe('buildPrompt', () => {
  it('includes numbered passages with source and heading, and forbids guessing', async () => {
    const ctx = await setup();
    const chunks = await ctx.retrieve('credits', 2);
    const prompt = buildPrompt('credits', chunks);
    expect(prompt).toContain('[1] (faq.md — What are credits?)');
    expect(prompt).toContain('ONLY the numbered passages');
    expect(prompt).toContain('I do not know');
  });
});
