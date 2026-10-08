import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { AppContext } from '../../src/context.js';
import { handleOrderCreated } from '../../src/handlers/order.js';
import type { EventEnvelope, OrderCreatedPayload } from '@foc/shared-events';
import {
  createTestContext, resetDatabase, cleanup, seedWalletFromPool,
  testApp, TEST_USER_ID, TEST_RUNNER_ID, TEST_ADMIN_ID,
} from '../helpers.js';

let ctx: AppContext;
let app: ReturnType<typeof testApp>;

function env<T>(type: string, payload: T): EventEnvelope<T> {
  return { eventId: randomUUID(), type, version: 1, occurredAt: new Date().toISOString(), correlationId: randomUUID(), payload };
}

beforeAll(async () => {
  // Admin context: stub auth injects admin role.
  ctx = await createTestContext(TEST_ADMIN_ID, ['user', 'admin']);
  app = testApp(ctx);
});
afterAll(async () => { await cleanup(ctx); });
beforeEach(async () => { await resetDatabase(ctx); });

// ── GET /v1/admin/credits/summary ──

describe('GET /v1/admin/credits/summary', () => {
  it('returns correct totals across multiple wallets', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);
    await seedWalletFromPool(ctx, TEST_RUNNER_ID, 50);

    const res = await request(app).get('/v1/admin/credits/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.totalWallets).toBe(2);
    expect(res.body.data.totalAvailable).toBe(150);
    expect(res.body.data.totalReserved).toBe(0);
    expect(res.body.data.totalCredits).toBe(150);
  });

  it('reflects reserved credits correctly', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    const client = await ctx.pool.connect();
    try {
      await client.query('BEGIN');
      await handleOrderCreated(client, env<OrderCreatedPayload>('OrderCreated', {
        orderId: randomUUID(), requesterId: TEST_USER_ID, creditAmount: 30,
      }), ctx.logger);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const res = await request(app).get('/v1/admin/credits/summary');
    expect(res.body.data.totalAvailable).toBe(70);
    expect(res.body.data.totalReserved).toBe(30);
    expect(res.body.data.totalCredits).toBe(100);
  });
});

// ── GET /v1/admin/credits/users/:userId/history ──

describe('GET /v1/admin/credits/users/:userId/history', () => {
  it('returns ledger for specified user', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);
    await seedWalletFromPool(ctx, TEST_RUNNER_ID, 50);

    const res = await request(app).get(`/v1/admin/credits/users/${TEST_USER_ID}/history`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe('ISSUANCE');
    expect(res.body.data[0].amount).toBe(100);
  });

  it('pagination and type filter work', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    // Create 2 reservations = 3 ledger entries.
    for (let i = 0; i < 2; i++) {
      const client = await ctx.pool.connect();
      try {
        await client.query('BEGIN');
        await handleOrderCreated(client, env<OrderCreatedPayload>('OrderCreated', {
          orderId: randomUUID(), requesterId: TEST_USER_ID, creditAmount: 5,
        }), ctx.logger);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    }

    // Paginated
    const res = await request(app).get(`/v1/admin/credits/users/${TEST_USER_ID}/history?page=1&limit=2`);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.totalItems).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);

    // Filtered
    const res2 = await request(app).get(`/v1/admin/credits/users/${TEST_USER_ID}/history?type=ISSUANCE`);
    expect(res2.body.data).toHaveLength(1);
    expect(res2.body.pagination.totalItems).toBe(1);
  });

  it('400 with invalid userId format', async () => {
    const res = await request(app).get('/v1/admin/credits/users/not-a-uuid/history');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── POST /v1/admin/credits/adjustments ──

describe('POST /v1/admin/credits/adjustments', () => {
  it('201 — grants credits (positive amount)', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    const res = await request(app)
      .post('/v1/admin/credits/adjustments')
      .send({ userId: TEST_USER_ID, amount: 50, reason: 'bonus' });

    expect(res.status).toBe(201);
    expect(res.body.data.balanceAfter).toBe(150);
    expect(res.body.data.amount).toBe(50);
    expect(res.body.data.reason).toBe('bonus');
  });

  it('201 — deducts credits (negative amount)', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    const res = await request(app)
      .post('/v1/admin/credits/adjustments')
      .send({ userId: TEST_USER_ID, amount: -30, reason: 'penalty' });

    expect(res.status).toBe(201);
    expect(res.body.data.balanceAfter).toBe(70);
  });

  it('records an ADJUSTMENT ledger entry', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    await request(app)
      .post('/v1/admin/credits/adjustments')
      .send({ userId: TEST_USER_ID, amount: 25, reason: 'compensation' });

    const { rows } = await ctx.pool.query(
      "SELECT type, amount, balance_after FROM ledger WHERE user_id = $1 AND type = 'ADJUSTMENT'",
      [TEST_USER_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(25);
    expect(rows[0].balance_after).toBe(125);
  });

  it('404 — wallet not found', async () => {
    const res = await request(app)
      .post('/v1/admin/credits/adjustments')
      .send({ userId: randomUUID(), amount: 10, reason: 'test' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('WALLET_NOT_FOUND');
  });

  it('422 — insufficient credits for deduction', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 10);

    const res = await request(app)
      .post('/v1/admin/credits/adjustments')
      .send({ userId: TEST_USER_ID, amount: -50, reason: 'penalty' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
  });

  it('400 — zero amount rejected', async () => {
    const res = await request(app)
      .post('/v1/admin/credits/adjustments')
      .send({ userId: TEST_USER_ID, amount: 0, reason: 'noop' });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── GET /v1/admin/credits/reconciliation ──

describe('GET /v1/admin/credits/reconciliation', () => {
  it('returns healthy when wallet and ledger totals match', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);
    await seedWalletFromPool(ctx, TEST_RUNNER_ID, 50);

    const res = await request(app).get('/v1/admin/credits/reconciliation');
    expect(res.status).toBe(200);
    expect(res.body.data.walletTotal).toBe(150);
    expect(res.body.data.ledgerTotal).toBe(150);
    expect(res.body.data.healthy).toBe(true);
  });

  it('returns healthy after reserve + settle cycle', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);
    await seedWalletFromPool(ctx, TEST_RUNNER_ID, 100);

    // Reserve 30
    const client = await ctx.pool.connect();
    try {
      await client.query('BEGIN');
      await handleOrderCreated(client, env<OrderCreatedPayload>('OrderCreated', {
        orderId: randomUUID(), requesterId: TEST_USER_ID, creditAmount: 30,
      }), ctx.logger);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const res = await request(app).get('/v1/admin/credits/reconciliation');
    expect(res.body.data.walletTotal).toBe(200);
    expect(res.body.data.healthy).toBe(true);
  });
});

// ── GET /v1/admin/credits/users/:userId/balance-at ──

describe('GET /v1/admin/credits/users/:userId/balance-at', () => {
  it('returns balance at a given timestamp', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    // Record a second event after a tiny delay so timestamps differ.
    const client = await ctx.pool.connect();
    try {
      await client.query('BEGIN');
      await handleOrderCreated(client, env<OrderCreatedPayload>('OrderCreated', {
        orderId: randomUUID(), requesterId: TEST_USER_ID, creditAmount: 20,
      }), ctx.logger);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Query balance at a far future timestamp — should reflect all entries.
    const future = new Date(Date.now() + 86400000).toISOString();
    const res = await request(app).get(`/v1/admin/credits/users/${TEST_USER_ID}/balance-at?ts=${future}`);
    expect(res.status).toBe(200);
    expect(res.body.data.availableBalance).toBe(80); // 100 - 20
  });

  it('returns 0 when no entries exist before timestamp', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    // Query at a timestamp far in the past.
    const past = '2000-01-01T00:00:00.000Z';
    const res = await request(app).get(`/v1/admin/credits/users/${TEST_USER_ID}/balance-at?ts=${past}`);
    expect(res.status).toBe(200);
    expect(res.body.data.availableBalance).toBe(0);
  });

  it('400 with invalid userId format', async () => {
    const res = await request(app).get('/v1/admin/credits/users/not-a-uuid/balance-at?ts=2025-01-01T00:00:00.000Z');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
