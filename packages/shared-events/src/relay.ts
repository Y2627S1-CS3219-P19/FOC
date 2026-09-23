import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

export interface OutboxRelayOptions {
  pool: Pool;
  amqpUrl: string;
  /** Exchanges this service publishes to; declared as durable topic exchanges on connect. */
  exchanges: string[];
  logger: Logger;
  pollIntervalMs?: number;
  batchSize?: number;
  /** Dev only: a durable queue bound to every exchange with '#', so messages can be inspected in the RabbitMQ UI. */
  debugQueue?: string;
}

export interface OutboxRelay {
  stop(): Promise<void>;
}

/**
 * Polls outbox_events and publishes unsent rows to RabbitMQ with publisher confirms, marking them sent only
 * after the broker confirms. Delivery is at-least-once, so consumers must be idempotent (dedupe on eventId).
 */
export function startOutboxRelay(options: OutboxRelayOptions): OutboxRelay {
  const { pool, amqpUrl, exchanges, logger, pollIntervalMs = 500, batchSize = 50, debugQueue } = options;
  let connection: ChannelModel | null = null;
  let channel: ConfirmChannel | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function connect(): Promise<ConfirmChannel> {
    if (channel) return channel;
    connection = await amqp.connect(amqpUrl);
    connection.on('error', (err) => logger.warn({ err }, 'RabbitMQ connection error'));
    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed; will reconnect');
      connection = null;
      channel = null;
    });
    const ch = await connection.createConfirmChannel();
    for (const exchange of exchanges) await ch.assertExchange(exchange, 'topic', { durable: true });
    if (debugQueue) {
      await ch.assertQueue(debugQueue, { durable: true });
      for (const exchange of exchanges) await ch.bindQueue(debugQueue, exchange, '#');
    }
    logger.info({ exchanges }, 'Connected to RabbitMQ');
    channel = ch;
    return ch;
  }

  async function publishBatch(): Promise<number> {
    const ch = await connect();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string; exchange: string; routing_key: string; event_type: string; envelope: unknown }>(
        `SELECT id, exchange, routing_key, event_type, envelope FROM outbox_events
         WHERE published_at IS NULL ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }
      for (const row of rows) {
        const envelope = row.envelope as { correlationId?: string | null };
        ch.publish(row.exchange, row.routing_key, Buffer.from(JSON.stringify(row.envelope)), {
          persistent: true,
          messageId: row.id,
          type: row.event_type,
          contentType: 'application/json',
          timestamp: Math.floor(Date.now() / 1000),
          headers: envelope.correlationId ? { 'x-correlation-id': envelope.correlationId } : {},
        });
      }
      await ch.waitForConfirms();
      await client.query(`UPDATE outbox_events SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::uuid[])`, [
        rows.map((r) => r.id),
      ]);
      await client.query('COMMIT');
      logger.info({ count: rows.length, types: rows.map((r) => r.event_type) }, 'Published outbox events');
      return rows.length;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function tick() {
    if (stopped || running) return;
    running = true;
    let delay = pollIntervalMs;
    try {
      // Drain quickly while there is a backlog.
      while (!stopped && (await publishBatch()) === batchSize) {
        /* keep going */
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Outbox relay failed; retrying');
      channel = null;
      await connection?.close().catch(() => undefined);
      connection = null;
      delay = 5_000;
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, delay);
    }
  }

  timer = setTimeout(tick, 0);

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await connection?.close().catch(() => undefined);
    },
  };
}
