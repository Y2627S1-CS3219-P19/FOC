import { randomUUID } from 'node:crypto';
import amqp, { type ChannelModel, type Channel } from 'amqplib';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import {
  EXCHANGES,
  CREDIT_EVENTS,
  type EventEnvelope,
  type UserRegisteredPayload,
  type OrderCreatedPayload,
  type OrderCompletedPayload,
  type OrderWithdrawnPayload,
  type OrderCancelledPayload,
  type OrderExpiredPayload,
  addOutboxEvent,
} from '@foc/shared-events';

export interface ConsumerOptions {
  pool: Pool;
  amqpUrl: string;
  logger: Logger;
  initialCreditBalance: number;
}

export interface EventConsumer {
  stop(): Promise<void>;
}

const QUEUE_NAME = 'credit-service.events';

const BINDINGS: Array<{ exchange: string; routingKey: string }> = [
  { exchange: EXCHANGES.user, routingKey: 'user.registered' },
  { exchange: EXCHANGES.order, routingKey: 'order.created' },
  { exchange: EXCHANGES.order, routingKey: 'order.completed' },
  { exchange: EXCHANGES.order, routingKey: 'order.withdrawn' },
  { exchange: EXCHANGES.order, routingKey: 'order.cancelled' },
  { exchange: EXCHANGES.order, routingKey: 'order.expired' },
];

export function startEventConsumer(options: ConsumerOptions): EventConsumer {
  const { pool, amqpUrl, logger, initialCreditBalance } = options;
  let connection: ChannelModel | null = null;
  let channel: Channel | null = null;
  let stopped = false;

  async function connect(): Promise<Channel> {
    if (channel) return channel;

    connection = await amqp.connect(amqpUrl);
    connection.on('error', (err) => logger.warn({ err }, 'RabbitMQ consumer connection error'));
    connection.on('close', () => {
      if (stopped) return;
      logger.warn('RabbitMQ consumer connection closed; will reconnect');
      connection = null;
      channel = null;
      setTimeout(() => { void setup(); }, 5_000);
    });

    const ch = await connection.createChannel();
    await ch.prefetch(1);

    // Assert exchanges (idempotent — they may already exist from the producing service).
    for (const binding of BINDINGS) {
      await ch.assertExchange(binding.exchange, 'topic', { durable: true });
    }

    // Declare the consumer queue and bind to routing keys.
    await ch.assertQueue(QUEUE_NAME, { durable: true });
    for (const binding of BINDINGS) {
      await ch.bindQueue(QUEUE_NAME, binding.exchange, binding.routingKey);
    }

    channel = ch;
    logger.info({ queue: QUEUE_NAME }, 'RabbitMQ consumer connected');
    return ch;
  }

  async function handleMessage(ch: Channel, msg: amqp.ConsumeMessage): Promise<void> {
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(msg.content.toString()) as EventEnvelope;
    } catch {
      logger.error({ content: msg.content.toString().slice(0, 200) }, 'Failed to parse event envelope; discarding');
      ch.ack(msg);
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
      logger.error({ err: (err as Error).message, eventId: envelope.eventId, type: envelope.type }, 'Event processing failed; nacking');
      ch.nack(msg, false, true);
    } finally {
      client.release();
    }
  }

  // ── Event handlers ──

  async function handleUserRegistered(
    client: PoolClient,
    envelope: EventEnvelope<UserRegisteredPayload>,
    balance: number,
    log: Logger,
  ): Promise<void> {
    const { userId } = envelope.payload;

    // Create wallet with initial balance.
    await client.query(
      'INSERT INTO wallets (user_id, available_balance, reserved_balance) VALUES ($1, $2, 0) ON CONFLICT (user_id) DO NOTHING',
      [userId, balance],
    );

    // Record issuance in ledger.
    await client.query(
      `INSERT INTO ledger (id, user_id, reservation_id, type, amount, balance_after)
       VALUES ($1, $2, NULL, 'ISSUANCE', $3, $3)`,
      [randomUUID(), userId, balance],
    );

    // Publish CreditWalletCreated event via outbox.
    await addOutboxEvent(client, CREDIT_EVENTS.walletCreated, { userId, initialBalance: balance }, envelope.correlationId);

    log.info({ userId, balance }, 'Wallet created for new user');
  }

  async function handleOrderCreated(
    _client: PoolClient,
    envelope: EventEnvelope<OrderCreatedPayload>,
    log: Logger,
  ): Promise<void> {
    log.info({ orderId: envelope.payload.orderId }, 'OrderCreated received (stub — no credit reservation yet)');
  }

  async function handleOrderCompleted(
    _client: PoolClient,
    envelope: EventEnvelope<OrderCompletedPayload>,
    log: Logger,
  ): Promise<void> {
    log.info({ orderId: envelope.payload.orderId }, 'OrderCompleted received (stub — no credit settlement yet)');
  }

  async function handleOrderWithdrawn(
    _client: PoolClient,
    envelope: EventEnvelope<OrderWithdrawnPayload>,
    log: Logger,
  ): Promise<void> {
    log.info({ orderId: envelope.payload.orderId }, 'OrderWithdrawn received (stub — no credit release yet)');
  }

  async function handleOrderCancelled(
    _client: PoolClient,
    envelope: EventEnvelope<OrderCancelledPayload>,
    log: Logger,
  ): Promise<void> {
    log.info({ orderId: envelope.payload.orderId }, 'OrderCancelled received (stub — no credit release yet)');
  }

  async function handleOrderExpired(
    _client: PoolClient,
    envelope: EventEnvelope<OrderExpiredPayload>,
    log: Logger,
  ): Promise<void> {
    log.info({ orderId: envelope.payload.orderId }, 'OrderExpired received (stub — no credit release yet)');
  }

  // ── Lifecycle ──

  async function setup(): Promise<void> {
    if (stopped) return;
    try {
      const ch = await connect();
      await ch.consume(QUEUE_NAME, (msg) => {
        if (msg) void handleMessage(ch, msg);
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Failed to start consumer; retrying in 5s');
      connection = null;
      channel = null;
      setTimeout(() => { void setup(); }, 5_000);
    }
  }

  // Start consuming.
  void setup();

  return {
    async stop() {
      stopped = true;
      await channel?.close().catch(() => undefined);
      await connection?.close().catch(() => undefined);
    },
  };
}
