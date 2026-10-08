import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import type pg from 'pg';
import type { Logger } from 'pino';
import { CREDIT_EVENTS, EXCHANGES, type CreditsReservedPayload, type EventEnvelope } from '@foc/shared-events';
import { withTransaction } from '../db.js';
import { applyTransition } from '../services/transitionService.js';
import { CREDIT_RESERVATION_FAILED, type CreditReservationFailedPayload } from './localEvents.js';

const QUEUE = 'order-service.credit-events';
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

export interface CreditConsumer {
  stop(): Promise<void>;
}

/** Durable queue, manual ack, reconnects after 5s. Same shape as credit-service/src/consumer.ts. */
export function startCreditConsumer(options: { pool: pg.Pool; amqpUrl: string; logger: Logger }): CreditConsumer {
  const { pool, amqpUrl, logger } = options;
  let connection: ChannelModel | null = null;
  let channel: Channel | null = null;
  let stopped = false;

  const retryLater = () => {
    if (!stopped) setTimeout(() => void setup(), 5_000);
  };

  async function onMessage(ch: Channel, msg: ConsumeMessage) {
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(msg.content.toString()) as EventEnvelope;
    } catch {
      logger.error('Credit event is not valid JSON; discarded');
      ch.ack(msg);
      return;
    }
    try {
      await handleCreditEvent(pool, envelope, logger);
      ch.ack(msg);
    } catch (err) {
      logger.error({ eventId: envelope.eventId, err: (err as Error).message }, 'Credit event failed; requeued');
      ch.nack(msg, false, true);
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
      const ch = await connection.createChannel();
      await ch.prefetch(1);
      await ch.assertExchange(EXCHANGES.credit, 'topic', { durable: true });
      await ch.assertQueue(QUEUE, { durable: true });
      for (const key of ROUTING_KEYS) await ch.bindQueue(QUEUE, EXCHANGES.credit, key);
      await ch.consume(QUEUE, (msg) => {
        if (msg) void onMessage(ch, msg);
      });
      channel = ch;
      logger.info({ queue: QUEUE, routingKeys: ROUTING_KEYS }, 'Credit consumer connected');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Credit consumer could not connect; retrying in 5s');
      connection = null;
      retryLater();
    }
  }

  void setup();

  return {
    async stop() {
      stopped = true;
      await channel?.close().catch(() => undefined);
      await connection?.close().catch(() => undefined);
    },
  };
}
