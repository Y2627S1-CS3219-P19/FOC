import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CREDIT_EVENTS, type EventEnvelope } from '@foc/shared-events';
import type { AppContext } from '../src/context.js';
import { handleCreditEvent } from '../src/events/creditConsumer.js';
import { CREDIT_RESERVATION_FAILED } from '../src/events/localEvents.js';
import { rejectStalePending } from '../src/jobs/sweepers.js';
import { createTestContext, insertOrder, resetDb } from './helpers.js';

const REQ = 'aaaaaaaa-0000-0000-0000-000000000001';

let ctx: AppContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.pool.end();
});
beforeEach(async () => {
  await resetDb(ctx);
});

const reserved = (orderId: string, eventId = randomUUID()): EventEnvelope => ({
  eventId,
  type: CREDIT_EVENTS.reserved.type,
  version: 1,
  occurredAt: new Date().toISOString(),
  correlationId: 'corr-credit-1',
  payload: { orderId, requesterId: REQ, amount: 5 },
});

const failed = (orderId: string): EventEnvelope => ({
  eventId: randomUUID(),
  type: CREDIT_RESERVATION_FAILED.type,
  version: 1,
  occurredAt: new Date().toISOString(),
  correlationId: 'corr-credit-2',
  payload: { orderId, requesterId: REQ, amount: 5, availableBalance: 2, reason: 'INSUFFICIENT_CREDITS' },
});

const order = async (id: string) => (await ctx.pool.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
const outboxKeys = async () =>
  (await ctx.pool.query('SELECT routing_key FROM outbox_events ORDER BY created_at')).rows.map((r) => r.routing_key);

describe('handleCreditEvent', () => {
  it('credit.reserved moves PENDING to OPEN, with history and order.opened', async () => {
    const id = await insertOrder(ctx, { requesterId: REQ, status: 'PENDING' });
    expect(await handleCreditEvent(ctx.pool, reserved(id), ctx.logger)).toBe('applied');
    expect(await order(id)).toMatchObject({ status: 'OPEN', version: 2 });
    const history = await ctx.pool.query(
      'SELECT from_status, to_status, actor_id FROM order_status_history WHERE order_id = $1',
      [id],
    );
    expect(history.rows).toEqual([{ from_status: 'PENDING', to_status: 'OPEN', actor_id: null }]);
    const outbox = await ctx.pool.query('SELECT routing_key, envelope FROM outbox_events');
    expect(outbox.rows[0].routing_key).toBe('order.opened');
    expect(outbox.rows[0].envelope.correlationId).toBe('corr-credit-1');
  });

  it('credit.reservation_failed moves PENDING to REJECTED and keeps the balance', async () => {
    const id = await insertOrder(ctx, { requesterId: REQ, status: 'PENDING' });
    expect(await handleCreditEvent(ctx.pool, failed(id), ctx.logger)).toBe('applied');
    expect(await order(id)).toMatchObject({ status: 'REJECTED', rejection_reason: 'INSUFFICIENT_CREDITS', rejection_balance: 2 });
    expect(await outboxKeys()).toEqual(['order.rejected']);
  });

  it('the same event twice is applied once', async () => {
    const id = await insertOrder(ctx, { requesterId: REQ, status: 'PENDING' });
    const event = reserved(id);
    expect(await handleCreditEvent(ctx.pool, event, ctx.logger)).toBe('applied');
    expect(await handleCreditEvent(ctx.pool, event, ctx.logger)).toBe('duplicate');
    expect(await order(id)).toMatchObject({ status: 'OPEN', version: 2 });
    expect(await outboxKeys()).toEqual(['order.opened']);
  });

  it('a late credit.reserved for a REJECTED order changes nothing but is still recorded', async () => {
    const id = await insertOrder(ctx, { requesterId: REQ, status: 'REJECTED' });
    const event = reserved(id);
    expect(await handleCreditEvent(ctx.pool, event, ctx.logger)).toBe('ignored');
    expect(await order(id)).toMatchObject({ status: 'REJECTED', version: 1 });
    expect(await outboxKeys()).toEqual([]);
    const processed = await ctx.pool.query('SELECT 1 FROM processed_events WHERE event_id = $1', [event.eventId]);
    expect(processed.rowCount).toBe(1);
  });
});

describe('pending sweeper', () => {
  it('rejects PENDING orders older than the timeout and leaves fresh ones', async () => {
    const stale = await insertOrder(ctx, { requesterId: REQ, status: 'PENDING', createdMinutesAgo: 10 });
    const fresh = await insertOrder(ctx, { requesterId: REQ, status: 'PENDING', createdMinutesAgo: 0 });
    expect(await rejectStalePending(ctx.pool, 120, ctx.logger)).toBe(1);
    expect(await order(stale)).toMatchObject({ status: 'REJECTED', rejection_reason: 'CREDIT_TIMEOUT', rejection_balance: null });
    expect(await order(fresh)).toMatchObject({ status: 'PENDING' });
    expect(await outboxKeys()).toEqual(['order.rejected']);
  });
});
