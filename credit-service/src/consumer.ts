import { randomUUID } from 'node:crypto';
import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import {
  EXCHANGES,
  type EventEnvelope,
  type UserRegisteredPayload,
  type OrderCreatedPayload,
  type OrderCompletedPayload,
  type OrderWithdrawnPayload,
  type OrderCancelledPayload,
  type OrderExpiredPayload,
} from '@foc/shared-events';
import { handleUserRegistered } from './handlers/user.js';
import {
  handleOrderCreated,
  handleOrderCompleted,
  handleOrderWithdrawn,
  handleOrderCancelled,
  handleOrderExpired,
  handleOrderRejected,
  type OrderRejectedPayload,
} from './handlers/order.js';

export interface ConsumerOptions {
  pool: Pool;
  amqpUrl: string;
  logger: Logger;
  initialCreditBalance: number;
  retryDelayMs: number;
}

export interface EventConsumer {
  isConnected(): boolean;
  dlqDepth(): Promise<number | null>;
  stop(): Promise<void>;
}

const QUEUE = 'credit-service.events';
const RETRY_QUEUE = `${QUEUE}.retry`;
export const DEAD_LETTER_QUEUE = `${QUEUE}.dlq`;
export const MAX_ATTEMPTS = 5;

const BINDINGS: Array<{ exchange: string; routingKey: string }> = [
  { exchange: EXCHANGES.user, routingKey: 'user.registered' },
  { exchange: EXCHANGES.order, routingKey: 'order.created' },
  { exchange: EXCHANGES.order, routingKey: 'order.completed' },
  { exchange: EXCHANGES.order, routingKey: 'order.withdrawn' },
  { exchange: EXCHANGES.order, routingKey: 'order.cancelled' },
  { exchange: EXCHANGES.order, routingKey: 'order.expired' },
  { exchange: EXCHANGES.order, routingKey: 'order.rejected' },
];

/** What to do after a failed attempt: try again later, or give up and dead-letter it. */
export function afterFailure(previousAttempts: number): { attempt: number; deadLetter: boolean } {
  const attempt = previousAttempts + 1;
  return { attempt, deadLetter: attempt >= MAX_ATTEMPTS };
}

export function startEventConsumer(options: ConsumerOptions): EventConsumer {
  const { pool, amqpUrl, logger, initialCreditBalance, retryDelayMs } = options;
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
    const originalRoutingKey = String(headers['x-original-routing-key'] ?? msg.fields.routingKey);
    ch.sendToQueue(target, msg.content, {
      persistent: true,
      contentType: msg.properties.contentType,
      messageId: msg.properties.messageId,
      expiration: deadLetter ? undefined : String(retryDelayMs),
      headers: {
        ...headers,
        'x-attempts': attempt,
        'x-last-error': error.slice(0, 500),
        'x-original-routing-key': originalRoutingKey,
      },
    });
    await ch.waitForConfirms();
    ch.ack(msg);
    const fields = {
      eventId,
      routingKey: originalRoutingKey,
      attempt,
      maxAttempts: MAX_ATTEMPTS,
      err: error,
      correlationId: headers['x-correlation-id'],
    };
    if (deadLetter) logger.error({ ...fields, queue: DEAD_LETTER_QUEUE }, 'Message dead-lettered');
    else logger.warn({ ...fields, retryInMs: retryDelayMs }, 'Retry scheduled');
  }

  async function handleMessage(ch: ConfirmChannel, msg: ConsumeMessage): Promise<void> {
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(msg.content.toString()) as EventEnvelope;
    } catch {
      await onFailure(ch, msg, 'Message is not valid JSON', undefined, true).catch((err) =>
        logger.error({ err: (err as Error).message }, 'Could not dead-letter an event'),
      );
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency check: skip if already processed.
      const { rows } = await client.query<{ event_id: string }>(
        'SELECT event_id FROM processed_events WHERE event_id = $1',
        [envelope.eventId],
      );
      if (rows.length > 0) {
        await client.query('COMMIT');
        ch.ack(msg);
        return;
      }

      // Dispatch by event type.
      switch (envelope.type) {
        case 'UserRegistered':
          await handleUserRegistered(client, envelope as EventEnvelope<UserRegisteredPayload>, initialCreditBalance, logger);
          break;
        case 'OrderCreated':
          await handleOrderCreated(client, envelope as EventEnvelope<OrderCreatedPayload>, logger);
          break;
        case 'OrderCompleted':
          await handleOrderCompleted(client, envelope as EventEnvelope<OrderCompletedPayload>, logger);
          break;
        case 'OrderWithdrawn':
          await handleOrderWithdrawn(client, envelope as EventEnvelope<OrderWithdrawnPayload>, logger);
          break;
        case 'OrderCancelled':
          await handleOrderCancelled(client, envelope as EventEnvelope<OrderCancelledPayload>, logger);
          break;
        case 'OrderExpired':
          await handleOrderExpired(client, envelope as EventEnvelope<OrderExpiredPayload>, logger);
          break;
        case 'OrderRejected':
          await handleOrderRejected(client, envelope as EventEnvelope<OrderRejectedPayload>, logger);
          break;
        default:
          logger.warn({ type: envelope.type }, 'Unknown event type; recording as processed');
      }

      // Record as processed (inside the same transaction).
      await client.query(
        'INSERT INTO processed_events (id, event_id, event_type) VALUES ($1, $2, $3)',
        [randomUUID(), envelope.eventId, envelope.type],
      );

      await client.query('COMMIT');
      ch.ack(msg);
      logger.info({ eventId: envelope.eventId, type: envelope.type }, 'Event processed');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      logger.error({ err: (err as Error).message, eventId: envelope.eventId, type: envelope.type }, 'Event processing failed');
      await onFailure(ch, msg, (err as Error).message, envelope.eventId).catch((sendErr) => {
        logger.error({ eventId: envelope.eventId, err: (sendErr as Error).message }, 'Could not schedule a retry; requeued');
        ch.nack(msg, false, true);
      });
    } finally {
      client.release();
    }
  }

  // ── Lifecycle ──

  async function setup(): Promise<void> {
    if (stopped) return;
    try {
      connection = await amqp.connect(amqpUrl);
      connection.on('error', (err) => logger.warn({ err: err.message }, 'RabbitMQ consumer connection error'));
      connection.on('close', () => {
        channel = null;
        connection = null;
        if (!stopped) logger.warn('RabbitMQ consumer connection closed; reconnecting');
        retryLater();
      });

      const ch = await connection.createConfirmChannel();
      await ch.prefetch(1);

      // Assert exchanges (idempotent — they may already exist from the producing service).
      for (const binding of BINDINGS) {
        await ch.assertExchange(binding.exchange, 'topic', { durable: true });
      }

      // Declare the consumer queue and bind to routing keys.
      await ch.assertQueue(QUEUE, { durable: true });
      await ch.assertQueue(RETRY_QUEUE, {
        durable: true,
        arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': QUEUE },
      });
      await ch.assertQueue(DEAD_LETTER_QUEUE, { durable: true });

      for (const binding of BINDINGS) {
        await ch.bindQueue(QUEUE, binding.exchange, binding.routingKey);
      }

      await ch.consume(QUEUE, (msg) => {
        if (msg) void handleMessage(ch, msg);
      });

      channel = ch;
      logger.info(
        { queue: QUEUE, retryQueue: RETRY_QUEUE, deadLetterQueue: DEAD_LETTER_QUEUE },
        'RabbitMQ consumer connected',
      );
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Failed to start consumer; retrying in 5s');
      connection = null;
      retryLater();
    }
  }

  // Start consuming.
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
