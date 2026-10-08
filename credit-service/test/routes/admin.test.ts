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
