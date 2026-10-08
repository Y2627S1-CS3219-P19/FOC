import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { AppContext } from '../../src/context.js';
import {
  createTestContext, resetDatabase, cleanup, seedWalletFromPool,
  testApp, INTERNAL_AUTH_HEADER, TEST_USER_ID,
} from '../helpers.js';

let ctx: AppContext;
let app: ReturnType<typeof testApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = testApp(ctx);
});
afterAll(async () => { await cleanup(ctx); });
beforeEach(async () => { await resetDatabase(ctx); });

describe('POST /v1/internal/credits/reserve', () => {
  it('201 — reserves credits successfully', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    const res = await request(app)
      .post('/v1/internal/credits/reserve')
      .set(INTERNAL_AUTH_HEADER)
      .send({ orderId: randomUUID(), requesterId: TEST_USER_ID, amount: 30 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('HELD');
    expect(res.body.data.amount).toBe(30);
    expect(res.body.data.reservationId).toBeDefined();
  });

  it('200 — idempotent on same orderId', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);
    const orderId = randomUUID();
    const body = { orderId, requesterId: TEST_USER_ID, amount: 30 };

    await request(app).post('/v1/internal/credits/reserve').set(INTERNAL_AUTH_HEADER).send(body);
    const res = await request(app).post('/v1/internal/credits/reserve').set(INTERNAL_AUTH_HEADER).send(body);

    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(30);
    expect(res.body.data.status).toBe('HELD');
  });

  it('404 — wallet not found', async () => {
    const res = await request(app)
      .post('/v1/internal/credits/reserve')
      .set(INTERNAL_AUTH_HEADER)
      .send({ orderId: randomUUID(), requesterId: randomUUID(), amount: 10 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('WALLET_NOT_FOUND');
  });

  it('422 — insufficient credits', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 10);

    const res = await request(app)
      .post('/v1/internal/credits/reserve')
      .set(INTERNAL_AUTH_HEADER)
      .send({ orderId: randomUUID(), requesterId: TEST_USER_ID, amount: 50 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
  });

  it('401 — missing internal auth header', async () => {
    const res = await request(app)
      .post('/v1/internal/credits/reserve')
      .send({ orderId: randomUUID(), requesterId: TEST_USER_ID, amount: 10 });

    expect(res.status).toBe(401);
  });

  it('400 — invalid body (missing fields)', async () => {
    const res = await request(app)
      .post('/v1/internal/credits/reserve')
      .set(INTERNAL_AUTH_HEADER)
      .send({ orderId: randomUUID() }); // missing requesterId and amount

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('400 — invalid body (negative amount)', async () => {
    const res = await request(app)
      .post('/v1/internal/credits/reserve')
      .set(INTERNAL_AUTH_HEADER)
      .send({ orderId: randomUUID(), requesterId: TEST_USER_ID, amount: -5 });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
