import type { Authenticator } from '@foc/shared-middleware';
import type { Logger } from 'pino';
import type { FaqEntry } from './corpus.js';
import type { Config } from './config.js';
import type { RetrievedChunk } from './retrieval.js';
import type { TicketStore } from './sqlTickets.js';

/** Why the FAQ cannot serve. Log/health only — the UI shows one generic message. */
export type KbReason = 'NO_MODEL_KEYS' | 'INGEST_FAILED' | 'STORE_DOWN' | 'KB_EMPTY';

/**
 * Knowledge-base capability: "can the feature serve?" — deliberately separate from readiness,
 * which answers "should the orchestrator replace this task?". A config fault is not fixed by a
 * restart, so it must not read as unhealthy.
 */
export interface KbStatus {
  ready: boolean;
  chunks: number;
  reason?: KbReason;
}

/** Everything the app and routes need, injected so tests can stub every piece. */
export interface AppContext {
  config: Config;
  logger: Logger;
  auth: Authenticator;
  /** Store-agnostic retrieval: Chroma in prod, in-memory in tests. */
  retrieve: (question: string, k: number) => Promise<RetrievedChunk[]>;
  /** One-line answer generator: prompt in, answer text out. Stubs keep tests offline. */
  generate: (prompt: string) => Promise<string>;
  /** Live chunk count: proves the store is reachable *and* that the knowledge base is populated. */
  countStore: () => Promise<number>;
  /** Knowledge-base capability, mutated on boot and readable by the health probe. */
  kb: KbStatus;
  /** F28.3 support tickets. No requester identity is stored: reply-to is the only contact. */
  tickets: TicketStore;
  /** The full knowledge base as entries, for the FAQ page's browse list. */
  listEntries: () => Promise<FaqEntry[]>;
}
