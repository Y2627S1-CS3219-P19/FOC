import type { Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { autoConfirmDelivered, expireOverdue, runEvery } from '../src/jobs/sweepers.js';
import { as, createTestContext, insertOrder, resetDb } from './helpers.js';

const REQ = 'aaaaaaaa-0000-0000-0000-000000000001';
const RUN = 'bbbbbbbb-0000-0000-0000-000000000002';

let ctx: AppContext;
// One shared server: supertest would otherwise start a new server for every request.
let api: Server;

beforeAll(async () => {
  ctx = await createTestContext();
  api = createApp(ctx).listen(0);
});
afterAll(async () => {
  api.close();
  await ctx.pool.end();
});
beforeEach(async () => {
  await resetDb(ctx);
});

const order = async (id: string) => (await ctx.pool.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
const outbox = async () =>
  (await ctx.pool.query('SELECT routing_key, envelope FROM outbox_events ORDER BY created_at')).rows as Array<{
    routing_key: string;
    envelope: { correlationId: string | null; payload: Record<string, unknown> };
  }>;

describe('expiry sweeper', () => {
  it('expires OPEN orders past expires_at and publishes order.expired', async () => {
    const overdue = await insertOrder(ctx, { requesterId: REQ, expiresInMinutes: -1 });
    const notYet = await insertOrder(ctx, { requesterId: REQ, expiresInMinutes: 30 });
    expect(await expireOverdue(ctx.pool, ctx.logger)).toBe(1);

    expect(await order(overdue)).toMatchObject({ status: 'EXPIRED', version: 2 });
    expect(await order(notYet)).toMatchObject({ status: 'OPEN', version: 1 });
    const events = await outbox();
    expect(events.map((e) => e.routing_key)).toEqual(['order.expired']);
    expect(events[0]!.envelope.payload).toEqual({ orderId: overdue, orderVersion: 2 });
    expect(events[0]!.envelope.correlationId).toEqual(expect.any(String));
    const history = await ctx.pool.query('SELECT actor_id, reason FROM order_status_history WHERE order_id = $1', [overdue]);
    expect(history.rows).toEqual([{ actor_id: null, reason: 'EXPIRED' }]);
  });

  it('leaves accepted orders alone even if their expiry has passed', async () => {
    const id = await insertOrder(ctx, { requesterId: REQ, runnerId: RUN, status: 'ACCEPTED', expiresInMinutes: -1 });
    expect(await expireOverdue(ctx.pool, ctx.logger)).toBe(0);
    expect((await order(id)).status).toBe('ACCEPTED');
  });

  it('running twice expires each order once', async () => {
    await insertOrder(ctx, { requesterId: REQ, expiresInMinutes: -1 });
    expect(await expireOverdue(ctx.pool, ctx.logger)).toBe(1);
    expect(await expireOverdue(ctx.pool, ctx.logger)).toBe(0);
    expect(await outbox()).toHaveLength(1);
  });
});

describe('auto-confirm sweeper', () => {
  const delivered = async (hoursAgo: number) => {
    const id = await insertOrder(ctx, { requesterId: REQ, runnerId: RUN, status: 'DELIVERED' });
    await ctx.pool.query(`UPDATE orders SET delivered_at = now() - make_interval(secs => $2) WHERE id = $1`, [
      id,
      hoursAgo * 3600,
    ]);
    return id;
  };

  it('completes orders delivered more than 24h ago and pays the runner', async () => {
    const old = await delivered(25);
    const recent = await delivered(1);
    expect(await autoConfirmDelivered(ctx.pool, 24, ctx.logger)).toBe(1);

    expect(await order(old)).toMatchObject({ status: 'COMPLETED', version: 2 });
    expect(await order(recent)).toMatchObject({ status: 'DELIVERED' });
    const events = await outbox();
    expect(events.map((e) => e.routing_key)).toEqual(['order.completed']);
    expect(events[0]!.envelope.payload).toEqual({
      orderId: old,
      requesterId: REQ,
      runnerId: RUN,
      creditAmount: 5,
      orderVersion: 2,
    });
  });

  it('a manual confirm after auto-confirm returns 200 and pays nothing twice', async () => {
    const id = await delivered(25);
    await autoConfirmDelivered(ctx.pool, 24, ctx.logger);
    const res = await request(api).post(`/v1/orders/${id}/confirm`).set(as(REQ));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'COMPLETED', version: 2 });
    expect((await outbox()).filter((e) => e.routing_key === 'order.completed')).toHaveLength(1);
  });

  it('auto-confirm after a manual confirm does nothing', async () => {
    const id = await delivered(25);
    expect((await request(api).post(`/v1/orders/${id}/confirm`).set(as(REQ))).status).toBe(200);
    expect(await autoConfirmDelivered(ctx.pool, 24, ctx.logger)).toBe(0);
    expect((await outbox()).filter((e) => e.routing_key === 'order.completed')).toHaveLength(1);
  });
});

describe('accept vs cancel vs expiry racing', () => {
  it('each order ends with exactly one outcome and one event', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await insertOrder(ctx, { requesterId: REQ }));
    // Make all of them expire about now, so all three can try at the same moment.
    await ctx.pool.query(`UPDATE orders SET expires_at = now() + interval '150 milliseconds'`);
    await sleep(140);

    await Promise.all([
      ...ids.flatMap((id) => [
        request(api).post(`/v1/orders/${id}/accept`).set(as(RUN)),
        request(api).post(`/v1/orders/${id}/cancel`).set(as(REQ)),
      ]),
      expireOverdue(ctx.pool, ctx.logger),
      sleep(20).then(() => expireOverdue(ctx.pool, ctx.logger)),
    ]);
    await expireOverdue(ctx.pool, ctx.logger); // anything still OPEN is now past expiry

    for (const id of ids) {
      const row = await order(id);
      expect(['ACCEPTED', 'CANCELLED', 'EXPIRED']).toContain(row.status);
      expect(row.version).toBe(2);
    }
    expect(await outbox()).toHaveLength(20);
  });
});

describe('runEvery', () => {
  it('never runs the task twice at the same time', async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const job = runEvery(
      'test',
      5,
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        runs++;
        await sleep(30);
        active--;
      },
      ctx.logger,
    );
    await sleep(120);
    job.stop();
    expect(runs).toBeGreaterThan(1);
    expect(maxActive).toBe(1);
  });
});
