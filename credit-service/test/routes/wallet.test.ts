import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { AppContext } from '../../src/context.js';
import { handleOrderCreated } from '../../src/handlers/order.js';
import type { EventEnvelope, OrderCreatedPayload } from '@foc/shared-events';
import {
  createTestContext, resetDatabase, cleanup, seedWalletFromPool,
  testApp, TEST_USER_ID,
} from '../helpers.js';

let ctx: AppContext;
let app: ReturnType<typeof testApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = testApp(ctx);
});
afterAll(async () => { await cleanup(ctx); });
beforeEach(async () => { await resetDatabase(ctx); });

function env<T>(type: string, payload: T): EventEnvelope<T> {
  return { eventId: randomUUID(), type, version: 1, occurredAt: new Date().toISOString(), correlationId: randomUUID(), payload };
}

// ── GET /v1/credits/wallet ──

describe('GET /v1/credits/wallet', () => {
  it('returns zero balances when no wallet exists', async () => {
    const res = await request(app).get('/v1/credits/wallet');
    expect(res.status).toBe(200);
    expect(res.body.data.availableBalance).toBe(0);
    expect(res.body.data.reservedBalance).toBe(0);
    expect(res.body.data.totalBalance).toBe(0);
  });

  it('returns correct balances after setup', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    const res = await request(app).get('/v1/credits/wallet');
    expect(res.status).toBe(200);
    expect(res.body.data.availableBalance).toBe(100);
    expect(res.body.data.reservedBalance).toBe(0);
    expect(res.body.data.totalBalance).toBe(100);
  });
});

// ── GET /v1/credits/reservations ──

describe('GET /v1/credits/reservations', () => {
  it('returns empty array when no reservations', async () => {
    const res = await request(app).get('/v1/credits/reservations');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.totalItems).toBe(0);
  });

  it('returns reservations with pagination metadata', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    // Create 3 reservations.
    for (let i = 0; i < 3; i++) {
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

    const res = await request(app).get('/v1/credits/reservations?page=1&limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.totalItems).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(2);

    // Page 2
    const res2 = await request(app).get('/v1/credits/reservations?page=2&limit=2');
    expect(res2.body.data).toHaveLength(1);
  });

  it('filters by status', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    // Create 2 reservations, release one.
    const orderId1 = randomUUID();
    const orderId2 = randomUUID();
    for (const orderId of [orderId1, orderId2]) {
      const client = await ctx.pool.connect();
      try {
        await client.query('BEGIN');
        await handleOrderCreated(client, env<OrderCreatedPayload>('OrderCreated', {
          orderId, requesterId: TEST_USER_ID, creditAmount: 10,
        }), ctx.logger);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    }
    // Release the first one.
    await ctx.pool.query("UPDATE reservations SET status = 'RELEASED', released_at = now() WHERE order_id = $1", [orderId1]);

    const res = await request(app).get('/v1/credits/reservations?status=HELD');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.totalItems).toBe(1);
  });
});

// ── GET /v1/credits/history ──

describe('GET /v1/credits/history', () => {
  it('returns ledger entries in descending order', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    // Create a reservation to add a second ledger entry.
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

    const res = await request(app).get('/v1/credits/history');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    // Most recent first.
    expect(res.body.data[0].type).toBe('RESERVE');
    expect(res.body.data[1].type).toBe('ISSUANCE');
  });

  it('pagination works', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

    // Create 2 reservations = 3 ledger entries total (1 issuance + 2 reserves).
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

    const res = await request(app).get('/v1/credits/history?page=1&limit=2');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.totalItems).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);
  });

  it('filters by type', async () => {
    await seedWalletFromPool(ctx, TEST_USER_ID, 100);

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

    const res = await request(app).get('/v1/credits/history?type=RESERVE');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe('RESERVE');
    expect(res.body.pagination.totalItems).toBe(1);
  });
});
