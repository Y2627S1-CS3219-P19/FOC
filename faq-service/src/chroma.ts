import { ChromaClient } from 'chromadb';
import { Document } from '@langchain/core/documents';
import { VectorStore } from '@langchain/core/vectorstores';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import type { Config } from './config.js';

export interface FaqStore {
  /** Upsert by deterministic id, so re-running ingestion never duplicates chunks. */
  addDocuments(documents: Document[], options?: { ids?: string[] }): Promise<void>;
  /** Returns [document, cosine similarity] with similarity in 0..1, higher is better. */
  similaritySearchWithScore(query: string, k: number): Promise<[Document, number][]>;
  /** How many chunks the collection holds — lets boot skip re-embedding an unchanged corpus. */
  count(): Promise<number>;
  /** Cheap server liveness probe for the health check. */
  ping(): Promise<void>;
}

/**
 * Chroma-backed store, exposed as a LangChain VectorStore. The rest of the service only sees the
 * FaqStore shape, so swapping stores (pgvector, Qdrant, an in-memory fake in tests) is one module.
 */
export class ChromaFaqStore extends VectorStore implements FaqStore {
  private client: ChromaClient;
  private collectionName: string;
  private collection: Promise<{
    upsert(params: { ids: string[]; embeddings: number[][]; documents: string[]; metadatas: Record<string, unknown>[] }): Promise<unknown>;
    count(): Promise<number>;
    query(params: { queryEmbeddings: number[][]; nResults: number; include?: string[] }): Promise<{
      documents: string[][];
      metadatas: Record<string, unknown>[][];
      distances: number[][];
    }>;
  }> | null = null;

  constructor(embeddings: EmbeddingsInterface, config: Config) {
    super(embeddings, {});
    this.client = new ChromaClient({ path: config.chromaUrl });
    this.collectionName = config.collection;
  }

  _vectorstoreType(): string {
    return 'chroma';
  }

  private async getCollection() {
    this.collection ??= this.client.getOrCreateCollection({
      name: this.collectionName,
      configuration: { hnsw: { space: 'cosine' } },
    }) as Promise<never>;
    return this.collection;
  }

  override async addVectors(vectors: number[][], documents: Document[], options?: { ids?: string[] }): Promise<void> {
    if (vectors.length !== documents.length) throw new Error('vectors and documents length mismatch');
    const ids = options?.ids ?? documents.map((_, i) => `${Date.now()}-${i}`);
    const collection = await this.getCollection();
    await collection.upsert({
      ids,
      embeddings: vectors,
      documents: documents.map((d) => d.pageContent),
      metadatas: documents.map((d) => d.metadata as Record<string, unknown>),
    });
  }

  override async addDocuments(documents: Document[], options?: { ids?: string[] }): Promise<void> {
    const vectors = await this.embeddings.embedDocuments(documents.map((d) => d.pageContent));
    await this.addVectors(vectors, documents, options);
  }

  override async similaritySearchVectorWithScore(query: number[], k: number): Promise<[Document, number][]> {
    const collection = await this.getCollection();
    const res = await collection.query({
      queryEmbeddings: [query],
      nResults: k,
      include: ['documents', 'metadatas', 'distances'],
    });
    return res.documents[0].map(
      (text, i) => [new Document({ pageContent: text, metadata: res.metadatas[0][i] }), 1 - res.distances[0][i]] as [Document, number],
    );
  }

  async count(): Promise<number> {
    const collection = await this.getCollection();
    return collection.count();
  }

  async ping(): Promise<void> {
    await (this.client as unknown as { heartbeat(): Promise<unknown> }).heartbeat();
  }
}

export function createVectorStore(config: Config, embeddings: EmbeddingsInterface): FaqStore {
  return new ChromaFaqStore(embeddings, config);
}
