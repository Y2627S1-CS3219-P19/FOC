import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import type pg from 'pg';
import type { Logger } from 'pino';
import { CREDIT_EVENTS, EXCHANGES, type CreditsReservedPayload, type EventEnvelope } from '@foc/shared-events';
import { withTransaction } from '../db.js';
import { applyTransition } from '../services/transitionService.js';
import { CREDIT_RESERVATION_FAILED, type CreditReservationFailedPayload } from './localEvents.js';

const QUEUE = 'order-service.credit-events';
/** Failed messages wait here, then RabbitMQ moves them back to QUEUE (dead-letter routing on expiry). */
const RETRY_QUEUE = `${QUEUE}.retry`;
/** Messages that failed MAX_ATTEMPTS times. Nothing reads this queue: a person looks at it in the RabbitMQ UI. */
export const DEAD_LETTER_QUEUE = `${QUEUE}.dlq`;
export const MAX_ATTEMPTS = 5;
const ROUTING_KEYS = [CREDIT_EVENTS.reserved.routingKey, CREDIT_RESERVATION_FAILED.routingKey];

export type HandleResult = 'applied' | 'duplicate' | 'ignored';

/**
 * Applies one credit event in one transaction: mark it processed, then move PENDING to OPEN or REJECTED.
 * Kept free of RabbitMQ so tests can call it directly.
 */
export async function handleCreditEvent(pool: pg.Pool, envelope: EventEnvelope, logger: Logger): Promise<HandleResult> {
  const log = logger.child({ eventId: envelope.eventId, type: envelope.type, correlationId: envelope.correlationId });
  return withTransaction(pool, async (client) => {
    const fresh = await client.query(
      'INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [envelope.eventId, envelope.type],
    );
    if (fresh.rowCount === 0) {
      log.info('Duplicate event skipped');
      return 'duplicate';
    }

    if (envelope.type === CREDIT_EVENTS.reserved.type) {
      const { orderId } = envelope.payload as CreditsReservedPayload;
      const order = await applyTransition(client, {
        action: 'open',
        actor: 'system',
        orderId,
        actorId: null,
        correlationId: envelope.correlationId,
        reason: 'CREDITS_RESERVED',
      });
      if (!order) {
        log.warn({ orderId }, 'credit.reserved for an order that is not PENDING; ignored');
        return 'ignored';
      }
      log.info({ orderId, from: 'PENDING', to: 'OPEN' }, 'Order transition');
      return 'applied';
    }

    if (envelope.type === CREDIT_RESERVATION_FAILED.type) {
      const p = envelope.payload as CreditReservationFailedPayload;
      const order = await applyTransition(client, {
        action: 'reject',
        actor: 'system',
        orderId: p.orderId,
        actorId: null,
        correlationId: envelope.correlationId,
        reason: p.reason,
      });
      if (!order) {
        log.warn({ orderId: p.orderId }, 'credit.reservation_failed for an order that is not PENDING; ignored');
        return 'ignored';
      }
      await client.query('UPDATE orders SET rejection_reason = $2, rejection_balance = $3 WHERE id = $1', [
        p.orderId,
        p.reason,
        p.availableBalance,
      ]);
      log.info({ orderId: p.orderId, from: 'PENDING', to: 'REJECTED', reason: p.reason }, 'Order transition');
      return 'applied';
    }

    log.warn('Unknown event type; recorded as processed');
    return 'ignored';
  });
}

/** What to do after a failed attempt: try again later, or give up and dead-letter it. */
export function afterFailure(previousAttempts: number): { attempt: number; deadLetter: boolean } {
  const attempt = previousAttempts + 1;
  return { attempt, deadLetter: attempt >= MAX_ATTEMPTS };
}

export interface CreditConsumer {
  /** True while the consumer has an open channel to RabbitMQ. Used by /health/ready. */
  isConnected(): boolean;
  /** Messages waiting in the dead-letter queue, or null when not connected. */
  dlqDepth(): Promise<number | null>;
  stop(): Promise<void>;
}

export interface CreditConsumerOptions {
  pool: pg.Pool;
  amqpUrl: string;
  logger: Logger;
  retryDelayMs: number;
}

/**
 * Durable queue, manual ack, reconnects after 5s. A failed message is retried after retryDelayMs, up to
 * MAX_ATTEMPTS times, then moved to the dead-letter queue, so one bad message never blocks the queue.
 */
export function startCreditConsumer(options: CreditConsumerOptions): CreditConsumer {
  const { pool, amqpUrl, logger, retryDelayMs } = options;
  let connection: ChannelModel | null = null;
  let channel: ConfirmChannel | null = null;
  let stopped = false;

  const retryLater = () => {
    if (!stopped) setTimeout(() => void setup(), 5_000);
  };

  /** Copies the message to the retry queue or the DLQ, waits for RabbitMQ to confirm, then acks the original. */
  async function onFailure(ch: ConfirmChannel, msg: ConsumeMessage, error: string, eventId: string | undefined, giveUp = false) {
    const headers = msg.properties.headers ?? {};
    const next = afterFailure(Number(headers['x-attempts'] ?? 0));
    const attempt = next.attempt;
    const deadLetter = giveUp || next.deadLetter;
    const target = deadLetter ? DEAD_LETTER_QUEUE : RETRY_QUEUE;
    // After a retry the message comes back with the queue name as routing key, so keep the first one.
    const originalRoutingKey = String(headers['x-original-routing-key'] ?? msg.fields.routingKey);
    ch.sendToQueue(target, msg.content, {
      persistent: true,
      contentType: msg.properties.contentType,
      messageId: msg.properties.messageId,
      expiration: deadLetter ? undefined : String(retryDelayMs),
      headers: { ...headers, 'x-attempts': attempt, 'x-last-error': error.slice(0, 500), 'x-original-routing-key': originalRoutingKey },
    });
    await ch.waitForConfirms();
    ch.ack(msg);
    const fields = { eventId, routingKey: originalRoutingKey, attempt, maxAttempts: MAX_ATTEMPTS, err: error, correlationId: headers['x-correlation-id'] };
    if (deadLetter) logger.error({ ...fields, queue: DEAD_LETTER_QUEUE }, 'Message dead-lettered');
    else logger.warn({ ...fields, retryInMs: retryDelayMs }, 'Retry scheduled');
  }

  async function onMessage(ch: ConfirmChannel, msg: ConsumeMessage) {
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(msg.content.toString()) as EventEnvelope;
    } catch {
      // Retrying cannot fix bad JSON: straight to the DLQ.
      await onFailure(ch, msg, 'Message is not valid JSON', undefined, true).catch((err) =>
        logger.error({ err: (err as Error).message }, 'Could not dead-letter a credit event'),
      );
      return;
    }
    try {
      await handleCreditEvent(pool, envelope, logger);
      ch.ack(msg);
    } catch (err) {
      await onFailure(ch, msg, (err as Error).message, envelope.eventId).catch((sendErr) => {
        // Could not reach the retry queue either: put it back on the main queue as the last resort.
        logger.error({ eventId: envelope.eventId, err: (sendErr as Error).message }, 'Could not schedule a retry; requeued');
        ch.nack(msg, false, true);
      });
    }
  }

  async function setup() {
    if (stopped) return;
    try {
      connection = await amqp.connect(amqpUrl);
      connection.on('error', (err) => logger.warn({ err: err.message }, 'Credit consumer connection error'));
      connection.on('close', () => {
        channel = null;
        connection = null;
        if (!stopped) logger.warn('Credit consumer connection closed; reconnecting');
        retryLater();
      });
      const ch = await connection.createConfirmChannel();
      await ch.prefetch(1);
      await ch.assertExchange(EXCHANGES.credit, 'topic', { durable: true });
      await ch.assertQueue(QUEUE, { durable: true });
      await ch.assertQueue(RETRY_QUEUE, {
        durable: true,
        arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': QUEUE },
      });
      await ch.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
      for (const key of ROUTING_KEYS) await ch.bindQueue(QUEUE, EXCHANGES.credit, key);
      await ch.consume(QUEUE, (msg) => {
        if (msg) void onMessage(ch, msg);
      });
      channel = ch;
      logger.info({ queue: QUEUE, routingKeys: ROUTING_KEYS, retryQueue: RETRY_QUEUE, deadLetterQueue: DEAD_LETTER_QUEUE }, 'Credit consumer connected');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Credit consumer could not connect; retrying in 5s');
      connection = null;
      retryLater();
    }
  }

  void setup();

  return {
    isConnected: () => channel !== null,
    async dlqDepth() {
      if (!channel) return null;
      return (await channel.checkQueue(DEAD_LETTER_QUEUE)).messageCount;
    },
    async stop() {
      stopped = true;
      await channel?.close().catch(() => undefined);
      await connection?.close().catch(() => undefined);
    },
  };
}
