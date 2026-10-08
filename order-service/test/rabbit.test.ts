import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDIT_EVENTS, EXCHANGES, startOutboxRelay, type EventEnvelope, type OutboxRelay } from '@foc/shared-events';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { DEAD_LETTER_QUEUE, MAX_ATTEMPTS, startCreditConsumer, type CreditConsumer } from '../src/events/creditConsumer.js';
import { as, createTestContext, inHours, supplier } from './helpers.js';

// Needs a real RabbitMQ, e.g. ORDERS_TEST_AMQP_URL=amqp://foc:test@localhost:5673 npx vitest run test/rabbit.test.ts
const AMQP_URL = process.env.ORDERS_TEST_AMQP_URL;
const REQ = 'aaaaaaaa-0000-0000-0000-000000000001';

describe.skipIf(!AMQP_URL)('with a real RabbitMQ', () => {
  let ctx: AppContext;
  let relay: OutboxRelay;
  let consumer: CreditConsumer;
  let conn: ChannelModel;
  let ch: Channel;
  const received: ConsumeMessage[] = [];

  beforeAll(async () => {
    ctx = await createTestContext();
    conn = await amqp.connect(AMQP_URL!);
    ch = await conn.createChannel();
    await ch.assertExchange(EXCHANGES.order, 'topic', { durable: true });
    await ch.assertExchange(EXCHANGES.credit, 'topic', { durable: true });
    // A private, auto-deleted queue that sees every order event, like a downstream service would.
    const { queue } = await ch.assertQueue('', { exclusive: true, autoDelete: true });
    await ch.bindQueue(queue, EXCHANGES.order, 'order.#');
    await ch.consume(queue, (msg) => msg && received.push(msg), { noAck: true });

    relay = startOutboxRelay({ pool: ctx.pool, amqpUrl: AMQP_URL!, exchanges: [EXCHANGES.order], logger: ctx.logger, pollIntervalMs: 100 });
    consumer = startCreditConsumer({ pool: ctx.pool, amqpUrl: AMQP_URL!, logger: ctx.logger, retryDelayMs: 100 });
    ctx.broker = consumer;
    await waitFor(() => consumer.isConnected());
    await ch.purgeQueue(DEAD_LETTER_QUEUE); // leftovers from an earlier run
  });

  afterAll(async () => {
    await consumer?.stop();
    await relay?.stop();
    await conn?.close();
    await ctx?.pool.end();
  });

  async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
    const start = Date.now();
    while (!(await check())) {
      if (Date.now() - start > timeoutMs) throw new Error('timed out');
      await sleep(50);
    }
  }

  const orderStatus = async (id: string) => (await ctx.pool.query('SELECT status FROM orders WHERE id = $1', [id])).rows[0]?.status;

  it('health shows the broker as UP', async () => {
    const res = await request(createApp(ctx)).get('/health/ready');
    expect(res.body.checks.broker).toBe('UP');
  });

  it('create -> order.created is published with the correlation id; credit.reserved (even twice) opens it once', async () => {
    const api = createApp(ctx);
    const res = await request(api)
      .post('/v1/orders')
      .set(as(REQ))
      .set('X-Correlation-Id', 'rabbit-test-0001')
      .send({ supplierId: supplier.id, deliveryLocation: 'COM1 lobby', items: ['1x kopi'], creditAmount: 5, expiresAt: inHours(2) });
    expect(res.status).toBe(202);
    const orderId = res.body.data.id;

    // 1. The relay publishes order.created from the outbox.
    await waitFor(() => received.some((m) => m.fields.routingKey === 'order.created'));
    const createdMsg = received.find((m) => m.fields.routingKey === 'order.created')!;
    const created = JSON.parse(createdMsg.content.toString()) as EventEnvelope<{ orderId: string }>;
    expect(created).toMatchObject({ type: 'OrderCreated', correlationId: 'rabbit-test-0001', payload: { orderId } });
    expect(createdMsg.properties.headers?.['x-correlation-id']).toBe('rabbit-test-0001');
    await waitFor(async () => (await ctx.pool.query('SELECT 1 FROM outbox_events WHERE published_at IS NULL')).rowCount === 0);

    // 2. Credit replies; send the same event twice, as a redelivery would.
    const reply: EventEnvelope = {
      eventId: randomUUID(),
      type: CREDIT_EVENTS.reserved.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: 'rabbit-test-0001',
      payload: { orderId, requesterId: REQ, amount: 5 },
    };
    for (let i = 0; i < 2; i++) ch.publish(EXCHANGES.credit, CREDIT_EVENTS.reserved.routingKey, Buffer.from(JSON.stringify(reply)));

    // 3. The consumer opens the order, and order.opened goes out once.
    await waitFor(async () => (await orderStatus(orderId)) === 'OPEN');
    await waitFor(() => received.some((m) => m.fields.routingKey === 'order.opened'));
    await sleep(500);
    expect(received.filter((m) => m.fields.routingKey === 'order.opened')).toHaveLength(1);
    const processed = await ctx.pool.query('SELECT 1 FROM processed_events WHERE event_id = $1', [reply.eventId]);
    expect(processed.rowCount).toBe(1);
  });

  it(`a message that always fails is retried, then dead-lettered after ${MAX_ATTEMPTS} attempts, without blocking others`, async () => {
    const api = createApp(ctx);
    const res = await request(api)
      .post('/v1/orders')
      .set(as(REQ))
      .send({ supplierId: supplier.id, deliveryLocation: 'COM1 lobby', items: ['1x kopi'], creditAmount: 5, expiresAt: inHours(2) });
    const goodOrderId = res.body.data.id;

    // orderId is not a uuid, so the UPDATE throws every time: a poison message.
    const poison: EventEnvelope = {
      eventId: randomUUID(),
      type: CREDIT_EVENTS.reserved.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: 'rabbit-poison-0001',
      payload: { orderId: 'not-a-uuid', requesterId: REQ, amount: 5 },
    };
    const good: EventEnvelope = { ...poison, eventId: randomUUID(), correlationId: 'rabbit-good-0001', payload: { orderId: goodOrderId, requesterId: REQ, amount: 5 } };
    ch.publish(EXCHANGES.credit, CREDIT_EVENTS.reserved.routingKey, Buffer.from(JSON.stringify(poison)));
    ch.publish(EXCHANGES.credit, CREDIT_EVENTS.reserved.routingKey, Buffer.from(JSON.stringify(good)));

    // The good message behind the poison one is processed straight away.
    await waitFor(async () => (await orderStatus(goodOrderId)) === 'OPEN', 3_000);

    // The poison message ends up in the DLQ after MAX_ATTEMPTS tries.
    await waitFor(async () => (await consumer.dlqDepth()) === 1);
    const dead = await ch.get(DEAD_LETTER_QUEUE, { noAck: true });
    expect(dead).not.toBe(false);
    if (dead === false) return;
    expect(JSON.parse(dead.content.toString()).eventId).toBe(poison.eventId);
    expect(dead.properties.headers).toMatchObject({ 'x-attempts': MAX_ATTEMPTS, 'x-original-routing-key': 'credit.reserved' });
    expect(String(dead.properties.headers?.['x-last-error'])).toContain('uuid');

    // A failed attempt rolls back, so the poison event is never marked processed.
    const processed = await ctx.pool.query('SELECT 1 FROM processed_events WHERE event_id = $1', [poison.eventId]);
    expect(processed.rowCount).toBe(0);
  });

  it('invalid JSON goes straight to the DLQ', async () => {
    ch.publish(EXCHANGES.credit, CREDIT_EVENTS.reserved.routingKey, Buffer.from('{not json'));
    await waitFor(async () => (await consumer.dlqDepth()) === 1);
    const dead = await ch.get(DEAD_LETTER_QUEUE, { noAck: true });
    expect(dead && dead.properties.headers?.['x-last-error']).toBe('Message is not valid JSON');
  });
});
