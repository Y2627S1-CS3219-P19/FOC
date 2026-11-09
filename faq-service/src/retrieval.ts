import type { Document } from '@langchain/core/documents';
import type { FaqStore } from './chroma.js';

export interface RetrievedChunk {
  doc: Document;
  /** Cosine similarity, 0..1, higher is better. Every store adapter normalises to this scale. */
  similarity: number;
}

/** Store-agnostic retrieval: the same contract whether Chroma, pgvector or memory backs it. */
export type Retrieve = (question: string, k: number) => Promise<RetrievedChunk[]>;

export function storeRetriever(store: FaqStore): Retrieve {
  return async (question, k) => {
    const hits = await store.similaritySearchWithScore(question, k);
    return hits.map(([doc, similarity]) => ({ doc, similarity }));
  };
}
