import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { ORDER_STATUSES, type OrderStatus } from '../src/domain/order.js';
import { TRANSITIONS } from '../src/domain/transitions.js';
import type { UserAction } from '../src/services/statusService.js';
import { as, createTestContext, insertOrder, resetDb } from './helpers.js';

const REQ = 'aaaaaaaa-0000-0000-0000-000000000001';
const RUN = 'bbbbbbbb-0000-0000-0000-000000000002';
const OTHER = 'cccccccc-0000-0000-0000-000000000003';
const ADMIN = 'dddddddd-0000-0000-0000-000000000004';

const ACTIONS: UserAction[] = ['accept', 'withdraw', 'collect', 'deliver', 'confirm', 'cancel'];
const HAS_RUNNER: OrderStatus[] = ['ACCEPTED', 'COLLECTED', 'DELIVERED', 'COMPLETED'];

let ctx: AppContext;
let api: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  api = createApp(ctx);
});
afterAll(async () => {
  await ctx.pool.end();
});
beforeEach(async () => {
  await resetDb(ctx);
});

const post = (id: string, action: string, userId: string, roles = 'user') =>
  request(api).post(`/v1/orders/${id}/${action}`).set(as(userId, roles));

const orderAt = (status: OrderStatus, requesterId = REQ) =>
  insertOrder(ctx, { requesterId, status, runnerId: HAS_RUNNER.includes(status) ? RUN : null });

const outboxKeys = async () =>
  (await ctx.pool.query('SELECT routing_key FROM outbox_events ORDER BY created_at')).rows.map((r) => r.routing_key);

/** The person who is allowed to try each action. */
const rightCaller = (action: UserAction) => (action === 'accept' ? OTHER : TRANSITIONS[action].actors.includes('runner') ? RUN : REQ);

describe('every action from every status (by the right person)', () => {
  for (const action of ACTIONS) {
    for (const status of ORDER_STATUSES) {
      const t = TRANSITIONS[action];
      const legal = t.from === status;
      const reconfirm = action === 'confirm' && status === 'COMPLETED';
      const expected = legal ? `200 -> ${t.to}` : reconfirm ? '200, unchanged' : '409';

      it(`${action} from ${status}: ${expected}`, async () => {
        const id = await orderAt(status);
        const res = await post(id, action, rightCaller(action));
        if (legal) {
          expect(res.status).toBe(200);
          expect(res.body.data).toMatchObject({ status: t.to, version: 2 });
          expect(await outboxKeys()).toEqual([t.event.routingKey]);
        } else if (reconfirm) {
          expect(res.status).toBe(200);
          expect(res.body.data).toMatchObject({ status: 'COMPLETED', version: 1 });
          expect(await outboxKeys()).toEqual([]);
        } else {
          expect(res.status).toBe(409);
          expect(['ILLEGAL_TRANSITION', 'ALREADY_ACCEPTED']).toContain(res.body.error.code);
          expect(await outboxKeys()).toEqual([]);
        }
      });
    }
  }
});

describe('authorization uses the relationship to this order, not the account role', () => {
  it('a requester cannot accept their own order', async () => {
    const id = await orderAt('OPEN');
    const res = await post(id, 'accept', REQ);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_ACCEPT_OWN_ORDER');
  });

  it.each(['withdraw', 'collect'] as const)('an unrelated user cannot %s', async (action) => {
    const id = await orderAt('ACCEPTED');
    const res = await post(id, action, OTHER);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ORDER_PARTICIPANT');
  });

  it('an unrelated user cannot deliver', async () => {
    const id = await orderAt('COLLECTED');
    expect((await post(id, 'deliver', OTHER)).body.error.code).toBe('NOT_ORDER_PARTICIPANT');
  });

  it('an unrelated user cannot cancel or confirm', async () => {
    expect((await post(await orderAt('OPEN'), 'cancel', OTHER)).body.error.code).toBe('NOT_ORDER_PARTICIPANT');
    expect((await post(await orderAt('DELIVERED'), 'confirm', OTHER)).body.error.code).toBe('NOT_ORDER_PARTICIPANT');
  });

  it('the requester cannot do runner actions, and the runner cannot do requester actions', async () => {
    const collect = await post(await orderAt('ACCEPTED'), 'collect', REQ);
    expect(collect.status).toBe(403);
    expect(collect.body.error.code).toBe('RUNNER_ONLY');
    const confirm = await post(await orderAt('DELIVERED'), 'confirm', RUN);
    expect(confirm.status).toBe(403);
    expect(confirm.body.error.code).toBe('REQUESTER_ONLY');
  });

  it('the admin role gives no extra rights over other people’s orders', async () => {
    const res = await post(await orderAt('OPEN'), 'cancel', ADMIN, 'user,admin');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ORDER_PARTICIPANT');
  });

  it('one user can be requester on one order and runner on another at the same time', async () => {
    const own = await orderAt('OPEN', REQ);
    const theirs = await orderAt('OPEN', OTHER);
    expect((await post(theirs, 'accept', REQ)).status).toBe(200);
    expect((await post(own, 'accept', OTHER)).status).toBe(200);
    expect((await post(theirs, 'collect', REQ)).status).toBe(200);
    expect((await post(own, 'cancel', REQ)).status).toBe(409); // already accepted by OTHER
  });

  it('401 without login, 404 for an unknown order, 422 for a bad id', async () => {
    expect((await request(api).post(`/v1/orders/${randomUUID()}/accept`)).status).toBe(401);
    expect((await post(randomUUID(), 'accept', OTHER)).status).toBe(404);
    expect((await post('nope', 'accept', OTHER)).status).toBe(422);
  });
});

describe('lifecycle', () => {
  it('accept -> collect -> deliver -> confirm, with history and events', async () => {
    const id = await orderAt('OPEN');
    expect((await post(id, 'accept', RUN)).body.data).toMatchObject({ status: 'ACCEPTED', runnerId: RUN });
    expect((await post(id, 'collect', RUN)).body.data.status).toBe('COLLECTED');
    const delivered = await post(id, 'deliver', RUN);
    expect(delivered.body.data.deliveredAt).not.toBeNull();
    const done = await post(id, 'confirm', REQ);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', version: 5 });

    expect(await outboxKeys()).toEqual(['order.accepted', 'order.collected', 'order.delivered', 'order.completed']);
    const completed = await ctx.pool.query(`SELECT envelope FROM outbox_events WHERE routing_key = 'order.completed'`);
    expect(completed.rows[0].envelope.payload).toEqual({ orderId: id, requesterId: REQ, runnerId: RUN, creditAmount: 5, orderVersion: 5 });
    const timeline = await request(api).get(`/v1/orders/${id}/timeline`).set(as(REQ));
    expect(timeline.body.data.map((h: { toStatus: string }) => h.toStatus)).toEqual(['ACCEPTED', 'COLLECTED', 'DELIVERED', 'COMPLETED']);
  });

  it('withdraw puts the order back to OPEN with no runner and the same expiry', async () => {
    const id = await orderAt('OPEN');
    const before = (await ctx.pool.query('SELECT expires_at FROM orders WHERE id = $1', [id])).rows[0].expires_at;
    await post(id, 'accept', RUN);
    const res = await post(id, 'withdraw', RUN);
    expect(res.body.data).toMatchObject({ status: 'OPEN', runnerId: null, version: 3 });
    expect(new Date(res.body.data.expiresAt)).toEqual(before);
    expect(await outboxKeys()).toEqual(['order.accepted', 'order.reopened']);
    expect((await post(id, 'accept', OTHER)).status).toBe(200);
  });

  it('cancel publishes order.cancelled with who cancelled', async () => {
    const id = await orderAt('OPEN');
    expect((await post(id, 'cancel', REQ)).body.data.status).toBe('CANCELLED');
    const { rows } = await ctx.pool.query('SELECT envelope FROM outbox_events');
    expect(rows[0].envelope.payload).toEqual({ orderId: id, cancelledBy: REQ, orderVersion: 2 });
  });

  it('an OPEN order past its expiry cannot be accepted', async () => {
    const id = await insertOrder(ctx, { requesterId: REQ, expiresInMinutes: -1 });
    const res = await post(id, 'accept', RUN);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_EXPIRED');
  });
});

describe('concurrency', () => {
  it('50 parallel accepts: exactly one runner wins, the rest get 409', async () => {
    const id = await orderAt('OPEN');
    const runners = Array.from({ length: 50 }, () => randomUUID());
    const results = await Promise.all(runners.map((r) => post(id, 'accept', r)));
    const winners = results.filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(49);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'ALREADY_ACCEPTED')).toBe(true);

    const row = (await ctx.pool.query('SELECT runner_id, version FROM orders WHERE id = $1', [id])).rows[0];
    expect(row).toEqual({ runner_id: winners[0]!.body.data.runnerId, version: 2 });
    expect(await outboxKeys()).toEqual(['order.accepted']);
  });

  it('accept racing cancel: each order ends up with exactly one outcome', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => orderAt('OPEN')));
    await Promise.all(ids.flatMap((id) => [post(id, 'accept', RUN), post(id, 'cancel', REQ)]));
    for (const id of ids) {
      const { rows } = await ctx.pool.query('SELECT status, version FROM orders WHERE id = $1', [id]);
      expect(['ACCEPTED', 'CANCELLED']).toContain(rows[0].status);
      expect(rows[0].version).toBe(2);
    }
    const events = await outboxKeys();
    expect(events).toHaveLength(20);
  });

  it('two confirms at once: both get 200, only one order.completed is written', async () => {
    const id = await orderAt('DELIVERED');
    const [a, b] = await Promise.all([post(id, 'confirm', REQ), post(id, 'confirm', REQ)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.data.status).toBe('COMPLETED');
    expect(b.body.data.status).toBe('COMPLETED');
    expect(await outboxKeys()).toEqual(['order.completed']);
  });
});
