import type { Queryable } from '../db.js';

export interface OutboxStats {
  /** Events saved but not yet confirmed by RabbitMQ. */
  backlog: number;
  /** Age of the oldest unpublished event, 0 if none. */
  oldestUnpublishedSeconds: number;
  /** Events published in the last 5 minutes, and how long they waited in the outbox. */
  publishedLast5m: number;
  avgPublishLagSeconds: number;
  maxPublishLagSeconds: number;
}

export async function outboxStats(db: Queryable): Promise<OutboxStats> {
  const { rows } = await db.query<Record<keyof OutboxStats, string>>(`
    SELECT
      (SELECT count(*) FROM outbox_events WHERE published_at IS NULL) AS "backlog",
      (SELECT coalesce(extract(epoch FROM now() - min(created_at)), 0) FROM outbox_events WHERE published_at IS NULL)
        AS "oldestUnpublishedSeconds",
      count(*) AS "publishedLast5m",
      coalesce(avg(extract(epoch FROM published_at - created_at)), 0) AS "avgPublishLagSeconds",
      coalesce(max(extract(epoch FROM published_at - created_at)), 0) AS "maxPublishLagSeconds"
    FROM outbox_events
    WHERE published_at > now() - interval '5 minutes'`);
  const r = rows[0]!;
  const round = (v: string) => Math.round(Number(v) * 100) / 100;
  return {
    backlog: Number(r.backlog),
    oldestUnpublishedSeconds: round(r.oldestUnpublishedSeconds),
    publishedLast5m: Number(r.publishedLast5m),
    avgPublishLagSeconds: round(r.avgPublishLagSeconds),
    maxPublishLagSeconds: round(r.maxPublishLagSeconds),
  };
}
