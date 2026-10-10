import type pg from 'pg';
import type { Logger } from 'pino';
import type { Broker } from '../context.js';
import { outboxStats } from '../repositories/outboxRepository.js';
import { runEvery, type Job } from './sweepers.js';

const EVERY_MS = 30_000;
/** An event this old and still unpublished means RabbitMQ (or the relay) is having trouble. */
const WARN_AFTER_SECONDS = 60;

/** Logs outbox backlog and publish lag, plus the dead-letter queue depth when RabbitMQ is in use. */
export async function logOutboxStatus(pool: pg.Pool, logger: Logger, broker?: Broker): Promise<void> {
  const stats = await outboxStats(pool);
  const dlqDepth = broker ? await broker.dlqDepth().catch(() => null) : null;
  if (stats.oldestUnpublishedSeconds > WARN_AFTER_SECONDS) {
    logger.warn({ outbox: stats, dlqDepth }, 'Outbox publish lag: events are waiting to be published');
  } else {
    logger.info({ outbox: stats, dlqDepth }, 'Outbox status');
  }
  if (dlqDepth) logger.warn({ dlqDepth }, 'Dead-letter queue has messages that need a look');
}

export function startOutboxMonitor(pool: pg.Pool, logger: Logger, broker?: Broker): Job {
  return runEvery('outbox-monitor', EVERY_MS, () => logOutboxStatus(pool, logger, broker), logger);
}
