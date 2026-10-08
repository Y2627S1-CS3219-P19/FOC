import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { SUSPENDED_USER, as, createTestContext, fakes, inHours, insertOrder, resetDb, supplier } from './helpers.js';

const REQ = 'aaaaaaaa-0000-0000-0000-000000000001';
const RUN = 'bbbbbbbb-0000-0000-0000-000000000002';
const OTHER = 'cccccccc-0000-0000-0000-000000000003';
const ADMIN = 'dddddddd-0000-0000-0000-000000000004';

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

const body = (over: Record<string, unknown> = {}) => ({
  supplierId: supplier.id,
  deliveryLocation: 'COM1 lobby',
  items: ['1x chicken rice', '1x kopi'],
  creditAmount: 5,
  expiresAt: inHours(2),
  ...over,
});

describe('POST /v1/orders', () => {
  it('401 without login, 403 when suspended', async () => {
    expect((await request(api).post('/v1/orders').send(body())).status).toBe(401);
    const res = await request(api).post('/v1/orders').set(as(SUSPENDED_USER)).send(body());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('422 with field errors for bad input', async () => {
    const res = await request(api).post('/v1/orders').set(as(REQ)).send(body({ items: [], creditAmount: 0, extra: 1 }));
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.details.fieldErrors).sort()).toEqual(['creditAmount', 'extra', 'items']);
  });

  it('400 when expiry is in the past or more than 24h away', async () => {
    const past = await request(api).post('/v1/orders').set(as(REQ)).send(body({ expiresAt: inHours(-1) }));
    expect(past.body.error.code).toBe('EXPIRY_NOT_IN_FUTURE');
    const far = await request(api).post('/v1/orders').set(as(REQ)).send(body({ expiresAt: inHours(25) }));
    expect(far.status).toBe(400);
    expect(far.body.error.code).toBe('EXPIRY_TOO_FAR');
  });

  it.each([
    ['NOT_FOUND', 'SUPPLIER_NOT_FOUND'],
    ['INACTIVE', 'SUPPLIER_INACTIVE'],
    ['CLOSED', 'SUPPLIER_CLOSED'],
  ] as const)('400 when supplier is %s', async (reason, code) => {
    fakes.supplierCheck = { valid: false, reason };
    const res = await request(api).post('/v1/orders').set(as(REQ)).send(body());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  it('202 saves a PENDING order, the supplier snapshot, a history row and one order.created event', async () => {
    const res = await request(api).post('/v1/orders').set(as(REQ)).set('X-Correlation-Id', 'test-corr-0001').send(body());
    expect(res.status).toBe(202);
    expect(res.headers.location).toBe(`/v1/orders/${res.body.data.id}`);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      requesterId: REQ,
      runnerId: null,
      supplier: { id: supplier.id, name: 'Cool Spot', building: 'Com2', facilityType: 'Food' },
      items: ['1x chicken rice', '1x kopi'],
      creditAmount: 5,
      rejection: null,
      version: 1,
    });
    const id = res.body.data.id;
    const history = await ctx.pool.query('SELECT from_status, to_status, actor_id FROM order_status_history WHERE order_id = $1', [id]);
    expect(history.rows).toEqual([{ from_status: null, to_status: 'PENDING', actor_id: REQ }]);
    const outbox = await ctx.pool.query('SELECT routing_key, envelope FROM outbox_events');
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].routing_key).toBe('order.created');
    expect(outbox.rows[0].envelope).toMatchObject({
      type: 'OrderCreated',
      correlationId: 'test-corr-0001',
      payload: { orderId: id, requesterId: REQ, creditAmount: 5, orderVersion: 1 },
    });
  });
});

describe('GET /v1/orders (open listing)', () => {
  it('shows only OPEN, unexpired orders from other people', async () => {
    const visible = await insertOrder(ctx, { requesterId: OTHER });
    await insertOrder(ctx, { requesterId: REQ }); // own
    await insertOrder(ctx, { requesterId: OTHER, status: 'ACCEPTED', runnerId: RUN });
    await insertOrder(ctx, { requesterId: OTHER, expiresInMinutes: -5 }); // past expiry, not swept yet
    await insertOrder(ctx, { requesterId: OTHER, status: 'PENDING' });
    await insertOrder(ctx, { requesterId: OTHER, status: 'REJECTED' });
    const res = await request(api).get('/v1/orders').set(as(REQ));
    expect(res.status).toBe(200);
    expect(res.body.data.map((o: { id: string }) => o.id)).toEqual([visible]);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 1 });
  });

  it('filters by building, facility type, delivery location, credit and remaining time', async () => {
    const a = await insertOrder(ctx, { requesterId: OTHER, building: 'Central Library', facilityType: 'Shopping', creditAmount: 3, expiresInMinutes: 30 });
    const b = await insertOrder(ctx, { requesterId: OTHER, building: 'Com2', deliveryLocation: 'UTown Residence', creditAmount: 8, expiresInMinutes: 300 });
    const ids = async (qs: string) => (await request(api).get(`/v1/orders?${qs}`).set(as(REQ))).body.data.map((o: { id: string }) => o.id);
    expect(await ids('building=central%20library')).toEqual([a]);
    expect(await ids('facilityType=shopping')).toEqual([a]);
    expect(await ids('deliveryLocation=utown')).toEqual([b]);
    expect(await ids('minCredit=5')).toEqual([b]);
    expect(await ids('maxCredit=5')).toEqual([a]);
    expect(await ids('maxRemainingMinutes=60')).toEqual([a]);
    expect(await ids('minRemainingMinutes=60')).toEqual([b]);
    expect(await ids('sort=credit&order=desc')).toEqual([b, a]);
    expect(await ids('sort=expiry')).toEqual([a, b]);
  });

  it('paginates', async () => {
    for (let i = 0; i < 3; i++) await insertOrder(ctx, { requesterId: OTHER });
    const res = await request(api).get('/v1/orders?limit=2&page=2').set(as(REQ));
    expect(res.body.data).toHaveLength(1);
    expect(res.body).toMatchObject({ page: 2, limit: 2, total: 3 });
  });

  it('400 for an impossible range, 422 for unknown filters', async () => {
    expect((await request(api).get('/v1/orders?minCredit=9&maxCredit=1').set(as(REQ))).body.error.code).toBe('INVALID_RANGE');
    expect((await request(api).get('/v1/orders?colour=red').set(as(REQ))).status).toBe(422);
  });
});

describe('GET /v1/orders/mine', () => {
  it('splits orders by the role the caller has on each order', async () => {
    const mineAsRequester = await insertOrder(ctx, { requesterId: REQ });
    const mineAsRunner = await insertOrder(ctx, { requesterId: OTHER, runnerId: REQ, status: 'ACCEPTED' });
    await insertOrder(ctx, { requesterId: OTHER });
    const ids = async (qs: string) => (await request(api).get(`/v1/orders/mine?${qs}`).set(as(REQ))).body.data.map((o: { id: string }) => o.id);
    expect(await ids('as=requester')).toEqual([mineAsRequester]);
    expect(await ids('as=runner')).toEqual([mineAsRunner]);
    expect(await ids('as=runner&status=OPEN')).toEqual([]);
  });
});

describe('GET /v1/orders/by-user/:userId', () => {
  it('admin sees every order where the user is requester or runner', async () => {
    const a = await insertOrder(ctx, { requesterId: REQ });
    const b = await insertOrder(ctx, { requesterId: OTHER, runnerId: REQ, status: 'ACCEPTED' });
    await insertOrder(ctx, { requesterId: OTHER });
    const res = await request(api).get(`/v1/orders/by-user/${REQ}`).set(as(ADMIN, 'user,admin'));
    expect(res.status).toBe(200);
    expect(res.body.data.map((o: { id: string }) => o.id).sort()).toEqual([a, b].sort());
  });

  it('403 for a regular user', async () => {
    const res = await request(api).get(`/v1/orders/by-user/${REQ}`).set(as(REQ));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });
});

describe('GET /v1/orders/:id', () => {
  it('PENDING and REJECTED orders are visible only to the requester and admins', async () => {
    for (const status of ['PENDING', 'REJECTED']) {
      const id = await insertOrder(ctx, { requesterId: REQ, status });
      expect((await request(api).get(`/v1/orders/${id}`).set(as(REQ))).status).toBe(200);
      expect((await request(api).get(`/v1/orders/${id}`).set(as(ADMIN, 'user,admin'))).status).toBe(200);
      expect((await request(api).get(`/v1/orders/${id}`).set(as(OTHER))).status).toBe(403);
    }
  });

  it('an OPEN order is visible to any logged-in user', async () => {
    const id = await insertOrder(ctx, { requesterId: REQ });
    expect((await request(api).get(`/v1/orders/${id}`).set(as(OTHER))).status).toBe(200);
  });

  it('once accepted, only requester, runner and admin can see it', async () => {
    const id = await insertOrder(ctx, { requesterId: REQ, runnerId: RUN, status: 'ACCEPTED' });
    const other = await request(api).get(`/v1/orders/${id}`).set(as(OTHER));
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('NOT_ORDER_PARTICIPANT');
    for (const [user, roles] of [[REQ, 'user'], [RUN, 'user'], [ADMIN, 'user,admin']]) {
      expect((await request(api).get(`/v1/orders/${id}`).set(as(user!, roles))).status).toBe(200);
    }
  });

  it('adds requester and runner summaries from the User Service, or null if missing', async () => {
    fakes.users.set(REQ, { id: REQ, displayName: 'Alice Tan', rating: 4.5 });
    const id = await insertOrder(ctx, { requesterId: REQ, runnerId: RUN, status: 'ACCEPTED' });
    const res = await request(api).get(`/v1/orders/${id}`).set(as(REQ));
    expect(res.body.data.requester).toEqual({ id: REQ, displayName: 'Alice Tan', rating: 4.5 });
    expect(res.body.data.runner).toBeNull();
  });

  it('404 for an unknown order, 422 for a bad id', async () => {
    expect((await request(api).get('/v1/orders/00000000-0000-0000-0000-000000000000').set(as(REQ))).status).toBe(404);
    expect((await request(api).get('/v1/orders/not-a-uuid').set(as(REQ))).status).toBe(422);
  });
});

describe('GET /v1/orders/:id/timeline', () => {
  it('requester sees the history; others cannot', async () => {
    const created = await request(api).post('/v1/orders').set(as(REQ)).send(body());
    const id = created.body.data.id;
    const res = await request(api).get(`/v1/orders/${id}/timeline`).set(as(REQ));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject([{ fromStatus: null, toStatus: 'PENDING', actorId: REQ }]);
    expect((await request(api).get(`/v1/orders/${id}/timeline`).set(as(OTHER))).status).toBe(403);
  });
});

describe('health', () => {
  it('reports the database as up', async () => {
    const res = await request(api).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.db).toBe(true);
  });
});
