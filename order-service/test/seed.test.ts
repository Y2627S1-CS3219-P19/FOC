import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context.js';
import { seedOrders } from '../src/seed.js';
import { createTestContext, resetDb } from './helpers.js';

let ctx: AppContext;

beforeAll(async () => {
  ctx = await createTestContext();
  await resetDb(ctx);
});
afterAll(async () => {
  await ctx.pool.end();
});

describe('seed', () => {
  it('inserts orders in every status, and running it again adds nothing', async () => {
    expect(await seedOrders(ctx.config.databaseUrl)).toBe(11);
    expect(await seedOrders(ctx.config.databaseUrl)).toBe(0);

    const { rows } = await ctx.pool.query<{ status: string; n: string }>(
      'SELECT status, count(*) AS n FROM orders GROUP BY status',
    );
    const counts = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    expect(counts).toEqual({
      OPEN: 4,
      ACCEPTED: 1,
      COLLECTED: 1,
      DELIVERED: 1,
      COMPLETED: 1,
      CANCELLED: 1,
      EXPIRED: 1,
      REJECTED: 1,
    });
  });

  it('every order has a history that ends in its status, and version = number of history rows', async () => {
    const { rows } = await ctx.pool.query(`
      SELECT o.status, o.version,
             (SELECT count(*) FROM order_status_history h WHERE h.order_id = o.id)::int AS steps,
             (SELECT to_status FROM order_status_history h WHERE h.order_id = o.id ORDER BY occurred_at DESC LIMIT 1) AS last
      FROM orders o`);
    for (const r of rows) {
      expect(r.last).toBe(r.status);
      expect(r.version).toBe(r.steps);
    }
  });

  it('writes no outbox events, so Credit Service is not affected', async () => {
    expect((await ctx.pool.query('SELECT 1 FROM outbox_events')).rowCount).toBe(0);
  });
});
