// TEMPORARY MOCK, delete when the real service is integrated.
//
// Run: AMQP_URL=amqp://foc:<password>@localhost:5672 MOCK_MODE=success npm run mock:credit
//   success      -> credit.reserved
//   insufficient -> credit.reservation_failed (availableBalance 2)
//   silent       -> no reply, so the pending sweeper rejects the order with CREDIT_TIMEOUT
import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import { CREDIT_EVENTS, EXCHANGES, ORDER_EVENTS, type EventEnvelope, type OrderCreatedPayload } from '@foc/shared-events';
import { CREDIT_RESERVATION_FAILED } from '../src/events/localEvents.js';

const amqpUrl = process.env.AMQP_URL;
const mode = process.env.MOCK_MODE ?? 'success';
if (!amqpUrl) throw new Error('Set AMQP_URL, e.g. amqp://foc:<password>@localhost:5672');
if (!['success', 'insufficient', 'silent'].includes(mode)) throw new Error('MOCK_MODE must be success, insufficient or silent');

const connection = await amqp.connect(amqpUrl);
const ch = await connection.createConfirmChannel();
await ch.assertExchange(EXCHANGES.order, 'topic', { durable: true });
await ch.assertExchange(EXCHANGES.credit, 'topic', { durable: true });
// Not durable and auto-deleted: a mock should leave nothing behind in RabbitMQ.
const { queue } = await ch.assertQueue('credit-mock.order-created', { durable: false, autoDelete: true });
await ch.bindQueue(queue, EXCHANGES.order, ORDER_EVENTS.created.routingKey);
console.log(`Credit mock listening for ${ORDER_EVENTS.created.routingKey} in "${mode}" mode`);

await ch.consume(queue, (msg) => {
  if (!msg) return;
  const order = JSON.parse(msg.content.toString()) as EventEnvelope<OrderCreatedPayload>;
  ch.ack(msg);
  if (mode === 'silent') {
    console.log(`order ${order.payload.orderId}: no reply (silent)`);
    return;
  }
  const reply =
    mode === 'success'
      ? { def: CREDIT_EVENTS.reserved, payload: { orderId: order.payload.orderId, requesterId: order.payload.requesterId, amount: order.payload.creditAmount } }
      : {
          def: CREDIT_RESERVATION_FAILED,
          payload: {
            orderId: order.payload.orderId,
            requesterId: order.payload.requesterId,
            amount: order.payload.creditAmount,
            availableBalance: 2,
            reason: 'INSUFFICIENT_CREDITS',
          },
        };
  const envelope: EventEnvelope = {
    eventId: randomUUID(),
    type: reply.def.type,
    version: reply.def.version,
    occurredAt: new Date().toISOString(),
    correlationId: order.correlationId,
    payload: reply.payload,
  };
  ch.publish(EXCHANGES.credit, reply.def.routingKey, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
    messageId: envelope.eventId,
  });
  console.log(`order ${order.payload.orderId}: sent ${reply.def.routingKey}`);
});

process.on('SIGINT', () => void connection.close().then(() => process.exit(0)));
