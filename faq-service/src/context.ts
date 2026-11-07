import type { Authenticator } from '@foc/shared-middleware';
import type { Logger } from 'pino';
import type { FaqEntry } from './corpus.js';
import type { Config } from './config.js';
import type { RetrievedChunk } from './retrieval.js';
import type { TicketStore } from './sqlTickets.js';

/** Everything the app and routes need, injected so tests can stub every piece. */
export interface AppContext {
  config: Config;
  logger: Logger;
  auth: Authenticator;
  /** Store-agnostic retrieval: Chroma in prod, in-memory in tests. */
  retrieve: (question: string, k: number) => Promise<RetrievedChunk[]>;
  /** One-line answer generator: prompt in, answer text out. Stubs keep tests offline. */
  generate: (prompt: string) => Promise<string>;
  /** Health probe for the vector store. */
  pingStore: () => Promise<void>;
  /** F28.3 support tickets. No requester identity is stored: reply-to is the only contact. */
  tickets: TicketStore;
  /** The full knowledge base as entries, for the FAQ page's browse list. */
  listEntries: () => Promise<FaqEntry[]>;
}
