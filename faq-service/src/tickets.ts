import { randomUUID } from 'node:crypto';
import { ChromaClient } from 'chromadb';

export interface SupportTicket {
  ticketId: string;
  userId: string;
  question: string;
  matchedTopics: string[];
  replyTo?: string;
  status: 'open';
  createdAt: string;
}

export interface TicketStore {
  add(ticket: SupportTicket): Promise<void>;
  listOpen(limit: number): Promise<SupportTicket[]>;
  ping(): Promise<void>;
}

/**
 * Tickets live in their own Chroma collection — the FAQ service's own store, no SQL database.
 * Chroma metadata only takes scalars, so matchedTopics is stored JSON-encoded.
 */
export class ChromaTicketStore implements TicketStore {
  private client: ChromaClient;
  private collectionName: string;
  private collection: Promise<{
    add(params: { ids: string[]; documents: string[]; metadatas: Record<string, string>[]; embeddings: number[][] }): Promise<unknown>;
    get(params: { where: Record<string, string>; include?: string[]; limit?: number }): Promise<{
      ids: string[];
      documents: string[];
      metadatas: Record<string, string>[];
    }>;
  }> | null = null;

  constructor(config: { chromaUrl: string; ticketCollection: string }) {
    this.client = new ChromaClient({ path: config.chromaUrl });
    this.collectionName = config.ticketCollection;
  }

  private async getCollection() {
    this.collection ??= this.client.getOrCreateCollection({ name: this.collectionName }) as Promise<never>;
    return this.collection;
  }

  async add(ticket: SupportTicket): Promise<void> {
    const collection = await this.getCollection();
    // Tickets are never searched semantically - only filtered by metadata - so the mandatory
    // embedding is a placeholder vector.
    await collection.add({
      ids: [ticket.ticketId],
      documents: [ticket.question],
      metadatas: [
        {
          userId: ticket.userId,
          replyTo: ticket.replyTo ?? '',
          matchedTopics: JSON.stringify(ticket.matchedTopics),
          status: ticket.status,
          createdAt: ticket.createdAt,
        },
      ],
      embeddings: [[0]],
    });
  }

  async listOpen(limit: number): Promise<SupportTicket[]> {
    const collection = await this.getCollection();
    const res = await collection.get({ where: { status: 'open' }, include: ['metadatas', 'documents'], limit });
    return res.ids.map((id, i) => ({
      ticketId: id,
      userId: res.metadatas[i].userId,
      question: res.documents[i],
      matchedTopics: JSON.parse(res.metadatas[i].matchedTopics ?? '[]') as string[],
      replyTo: res.metadatas[i].replyTo || undefined,
      status: 'open' as const,
      createdAt: res.metadatas[i].createdAt,
    }));
  }

  async ping(): Promise<void> {
    await (this.client as unknown as { heartbeat(): Promise<unknown> }).heartbeat();
  }
}

export function createTicketStore(config: { chromaUrl: string; ticketCollection: string }): TicketStore {
  return new ChromaTicketStore(config);
}

export function newTicket(input: {
  userId: string;
  question: string;
  matchedTopics: string[];
  replyTo?: string;
}): SupportTicket {
  return {
    ticketId: `t-${randomUUID().slice(0, 8)}`,
    userId: input.userId,
    question: input.question,
    matchedTopics: input.matchedTopics,
    replyTo: input.replyTo,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
}
