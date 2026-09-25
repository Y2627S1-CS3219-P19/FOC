import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { EventDefinition, EventEnvelope } from './events.js';

/**
 * SQL for the outbox table. Each publishing service includes this in its own migrations.
 * The event row is written in the SAME transaction as the state change, so an event is never lost
 * when the DB commits but the broker is down, and never sent for a change that rolled back.
 */
export const OUTBOX_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS outbox_events (
  id             uuid PRIMARY KEY,
  exchange       text NOT NULL,
  routing_key    text NOT NULL,
  event_type     text NOT NULL,
  envelope       jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz NULL,
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text NULL
);
CREATE INDEX IF NOT EXISTS outbox_events_unpublished_idx ON outbox_events (created_at) WHERE published_at IS NULL;
`;

type Queryable = Pool | PoolClient;

/** Queue an event for publishing. Call this inside the transaction that makes the change. */
export async function addOutboxEvent<T>(
  db: Queryable,
  event: EventDefinition<T>,
  payload: T,
  correlationId?: string | null,
): Promise<EventEnvelope<T>> {
  const envelope: EventEnvelope<T> = {
    eventId: randomUUID(),
    type: event.type,
    version: event.version,
    occurredAt: new Date().toISOString(),
    correlationId: correlationId ?? null,
    payload,
  };
  await db.query(
    `INSERT INTO outbox_events (id, exchange, routing_key, event_type, envelope) VALUES ($1, $2, $3, $4, $5)`,
    [envelope.eventId, event.exchange, event.routingKey, event.type, JSON.stringify(envelope)],
  );
  return envelope;
}
