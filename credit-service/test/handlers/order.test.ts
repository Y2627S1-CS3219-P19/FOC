import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AppContext } from '../../src/context.js';
import {
  handleOrderCreated,
  handleOrderCompleted,
  handleOrderWithdrawn,
  handleOrderCancelled,
  handleOrderExpired,
  handleOrderRejected,
} from '../../src/handlers/order.js';
import { handleUserRegistered } from '../../src/handlers/user.js';
import {
  createTestContext, resetDatabase, cleanup, seedWallet,
  TEST_USER_ID, TEST_RUNNER_ID,
} from '../helpers.js';
import type {
  EventEnvelope,
  OrderCreatedPayload,
  OrderCompletedPayload,
  OrderWithdrawnPayload,
  OrderCancelledPayload,
  OrderExpiredPayload,
} from '@foc/shared-events';
import type { OrderRejectedPayload } from '../../src/handlers/order.js';

let ctx: AppContext;

function env<T>(type: string, payload: T): EventEnvelope<T> {
  return { eventId: randomUUID(), type, version: 1, occurredAt: new Date().toISOString(), correlationId: randomUUID(), payload };
}

async function runInTx<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } finally {
    client.release();
  }
}

async function getWallet(userId: string) {
  const { rows } = await ctx.pool.query(
    'SELECT available_balance, reserved_balance FROM wallets WHERE user_id = $1', [userId],
  );
  return rows[0] as { available_balance: number; reserved_balance: number } | undefined;
}

beforeAll(async () => { ctx = await createTestContext(); });
afterAll(async () => { await cleanup(ctx); });
beforeEach(async () => { await resetDatabase(ctx); });

// ── handleOrderCreated ──

describe('handleOrderCreated', () => {
  it('reserves credits — available decreases, reserved increases', async () => {
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));

    const orderId = randomUUID();
    await runInTx((c) =>
      handleOrderCreated(c, env<OrderCreatedPayload>('OrderCreated', { orderId, requesterId: TEST_USER_ID, creditAmount: 30 }), ctx.logger),
    );

    const w = await getWallet(TEST_USER_ID);
    expect(w!.available_balance).toBe(70);
    expect(w!.reserved_balance).toBe(30);
  });

  it('creates a HELD reservation', async () => {
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));
    const orderId = randomUUID();
    await runInTx((c) =>
      handleOrderCreated(c, env<OrderCreatedPayload>('OrderCreated', { orderId, requesterId: TEST_USER_ID, creditAmount: 25 }), ctx.logger),
    );

    const { rows } = await ctx.pool.query('SELECT status, amount FROM reservations WHERE order_id = $1', [orderId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('HELD');
    expect(rows[0].amount).toBe(25);
  });

  it('records a RESERVE ledger entry with negative amount', async () => {
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));
    const orderId = randomUUID();
    await runInTx((c) =>
      handleOrderCreated(c, env<OrderCreatedPayload>('OrderCreated', { orderId, requesterId: TEST_USER_ID, creditAmount: 40 }), ctx.logger),
    );

    const { rows } = await ctx.pool.query(
      "SELECT type, amount, balance_after FROM ledger WHERE user_id = $1 AND type = 'RESERVE'", [TEST_USER_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(-40);
    expect(rows[0].balance_after).toBe(60);
  });

  it('publishes a CreditsReserved outbox event', async () => {
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));
    const orderId = randomUUID();
    await runInTx((c) =>
      handleOrderCreated(c, env<OrderCreatedPayload>('OrderCreated', { orderId, requesterId: TEST_USER_ID, creditAmount: 10 }), ctx.logger),
    );

    const { rows } = await ctx.pool.query("SELECT envelope FROM outbox_events WHERE event_type = 'CreditsReserved'");
    expect(rows).toHaveLength(1);
    expect(rows[0].envelope.payload.orderId).toBe(orderId);
    expect(rows[0].envelope.payload.amount).toBe(10);
  });

  it('publishes CreditReservationFailed when insufficient credits', async () => {
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 10));
    const orderId = randomUUID();
    await runInTx((c) =>
      handleOrderCreated(c, env<OrderCreatedPayload>('OrderCreated', { orderId, requesterId: TEST_USER_ID, creditAmount: 50 }), ctx.logger),
    );

    const w = await getWallet(TEST_USER_ID);
    expect(w!.available_balance).toBe(10);
    expect(w!.reserved_balance).toBe(0);

    const { rows: res } = await ctx.pool.query('SELECT * FROM reservations WHERE order_id = $1', [orderId]);
    expect(res).toHaveLength(0);

    const { rows } = await ctx.pool.query("SELECT envelope FROM outbox_events WHERE event_type = 'CreditReservationFailed'");
    expect(rows).toHaveLength(1);
    expect(rows[0].envelope.payload.orderId).toBe(orderId);
    expect(rows[0].envelope.payload.availableBalance).toBe(10);
    expect(rows[0].envelope.payload.reason).toBe('INSUFFICIENT_CREDITS');
  });

  it('publishes CreditReservationFailed when wallet not found', async () => {
    const orderId = randomUUID();
    const requesterId = randomUUID();
    await runInTx((c) =>
      handleOrderCreated(c, env<OrderCreatedPayload>('OrderCreated', { orderId, requesterId, creditAmount: 10 }), ctx.logger),
    );

    const { rows: res } = await ctx.pool.query('SELECT * FROM reservations WHERE order_id = $1', [orderId]);
    expect(res).toHaveLength(0);

    const { rows } = await ctx.pool.query("SELECT envelope FROM outbox_events WHERE event_type = 'CreditReservationFailed'");
    expect(rows).toHaveLength(1);
    expect(rows[0].envelope.payload.orderId).toBe(orderId);
    expect(rows[0].envelope.payload.availableBalance).toBeNull();
    expect(rows[0].envelope.payload.reason).toBe('NO_WALLET');
  });

  it('is idempotent — duplicate orderId skips', async () => {
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));
    const orderId = randomUUID();
    const payload: OrderCreatedPayload = { orderId, requesterId: TEST_USER_ID, creditAmount: 20 };

    await runInTx((c) => handleOrderCreated(c, env('OrderCreated', payload), ctx.logger));
    await runInTx((c) => handleOrderCreated(c, env('OrderCreated', payload), ctx.logger));

    const w = await getWallet(TEST_USER_ID);
    expect(w!.available_balance).toBe(80); // Only reserved once
    expect(w!.reserved_balance).toBe(20);

    const { rows } = await ctx.pool.query('SELECT * FROM reservations WHERE order_id = $1', [orderId]);
    expect(rows).toHaveLength(1);
  });
});

// ── handleOrderCompleted ──

describe('handleOrderCompleted', () => {
  async function setupReservation(amount = 30) {
    const orderId = randomUUID();
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));
    await runInTx((c) => seedWallet(c, TEST_RUNNER_ID, 100));
    await runInTx((c) =>
      handleOrderCreated(c, env<OrderCreatedPayload>('OrderCreated', { orderId, requesterId: TEST_USER_ID, creditAmount: amount }), ctx.logger),
    );
    return orderId;
  }

  it('settles reservation from HELD → SETTLED', async () => {
    const orderId = await setupReservation(30);
    await runInTx((c) =>
      handleOrderCompleted(c, env<OrderCompletedPayload>('OrderCompleted', { orderId, requesterId: TEST_USER_ID, runnerId: TEST_RUNNER_ID, creditAmount: 30 }), ctx.logger),
    );

    const { rows } = await ctx.pool.query('SELECT status, settled_at FROM reservations WHERE order_id = $1', [orderId]);
    expect(rows[0].status).toBe('SETTLED');
    expect(rows[0].settled_at).not.toBeNull();
  });

  it('debits requester reserved_balance and credits runner available_balance', async () => {
    const orderId = await setupReservation(30);
    await runInTx((c) =>
      handleOrderCompleted(c, env<OrderCompletedPayload>('OrderCompleted', { orderId, requesterId: TEST_USER_ID, runnerId: TEST_RUNNER_ID, creditAmount: 30 }), ctx.logger),
    );

    const req = await getWallet(TEST_USER_ID);
    expect(req!.available_balance).toBe(70);  // 100 - 30 reserved, stays 70
    expect(req!.reserved_balance).toBe(0);     // 30 reserved → settled → 0

    const run = await getWallet(TEST_RUNNER_ID);
    expect(run!.available_balance).toBe(130);  // 100 + 30
    expect(run!.reserved_balance).toBe(0);
  });

  it('records SETTLE_DEBIT and SETTLE_CREDIT ledger entries', async () => {
    const orderId = await setupReservation(30);
    await runInTx((c) =>
      handleOrderCompleted(c, env<OrderCompletedPayload>('OrderCompleted', { orderId, requesterId: TEST_USER_ID, runnerId: TEST_RUNNER_ID, creditAmount: 30 }), ctx.logger),
    );

    const { rows: debit } = await ctx.pool.query(
      "SELECT amount, balance_after FROM ledger WHERE user_id = $1 AND type = 'SETTLE_DEBIT'", [TEST_USER_ID],
    );
    expect(debit).toHaveLength(1);
    expect(debit[0].amount).toBe(-30);
    expect(debit[0].balance_after).toBe(70);

    const { rows: credit } = await ctx.pool.query(
      "SELECT amount, balance_after FROM ledger WHERE user_id = $1 AND type = 'SETTLE_CREDIT'", [TEST_RUNNER_ID],
    );
    expect(credit).toHaveLength(1);
    expect(credit[0].amount).toBe(30);
    expect(credit[0].balance_after).toBe(130);
  });

  it('publishes a CreditsReleased outbox event', async () => {
    const orderId = await setupReservation(30);
    await runInTx((c) =>
      handleOrderCompleted(c, env<OrderCompletedPayload>('OrderCompleted', { orderId, requesterId: TEST_USER_ID, runnerId: TEST_RUNNER_ID, creditAmount: 30 }), ctx.logger),
    );

    const { rows } = await ctx.pool.query("SELECT envelope FROM outbox_events WHERE event_type = 'CreditsReleased'");
    expect(rows).toHaveLength(1);
    expect(rows[0].envelope.payload.orderId).toBe(orderId);
    expect(rows[0].envelope.payload.runnerId).toBe(TEST_RUNNER_ID);
  });

  it('skips gracefully when no HELD reservation exists', async () => {
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));
    await runInTx((c) => seedWallet(c, TEST_RUNNER_ID, 100));

    await runInTx((c) =>
      handleOrderCompleted(c, env<OrderCompletedPayload>('OrderCompleted', { orderId: randomUUID(), requesterId: TEST_USER_ID, runnerId: TEST_RUNNER_ID, creditAmount: 30 }), ctx.logger),
    );

    // Wallets unchanged
    const req = await getWallet(TEST_USER_ID);
    expect(req!.available_balance).toBe(100);
  });
});

// ── Release handlers ──

describe('handleOrderWithdrawn / Cancelled / Expired', () => {
  async function setupReservation(amount = 30) {
    const orderId = randomUUID();
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));
    await runInTx((c) =>
      handleOrderCreated(c, env<OrderCreatedPayload>('OrderCreated', { orderId, requesterId: TEST_USER_ID, creditAmount: amount }), ctx.logger),
    );
    return orderId;
  }

  it('handleOrderWithdrawn releases credits back to available', async () => {
    const orderId = await setupReservation(30);
    await runInTx((c) =>
      handleOrderWithdrawn(c, env<OrderWithdrawnPayload>('OrderWithdrawn', { orderId }), ctx.logger),
    );

    const w = await getWallet(TEST_USER_ID);
    expect(w!.available_balance).toBe(100);
    expect(w!.reserved_balance).toBe(0);

    const { rows } = await ctx.pool.query('SELECT status, released_at FROM reservations WHERE order_id = $1', [orderId]);
    expect(rows[0].status).toBe('RELEASED');
    expect(rows[0].released_at).not.toBeNull();
  });

  it('handleOrderCancelled releases credits and records correct reason', async () => {
    const orderId = await setupReservation(25);
    await runInTx((c) =>
      handleOrderCancelled(c, env<OrderCancelledPayload>('OrderCancelled', { orderId, cancelledBy: TEST_USER_ID }), ctx.logger),
    );

    const w = await getWallet(TEST_USER_ID);
    expect(w!.available_balance).toBe(100);

    const { rows } = await ctx.pool.query("SELECT envelope FROM outbox_events WHERE event_type = 'CreditsReturned'");
    expect(rows).toHaveLength(1);
    expect(rows[0].envelope.payload.reason).toBe('cancelled');
  });

  it('handleOrderExpired releases credits and records correct reason', async () => {
    const orderId = await setupReservation(20);
    await runInTx((c) =>
      handleOrderExpired(c, env<OrderExpiredPayload>('OrderExpired', { orderId }), ctx.logger),
    );

    const w = await getWallet(TEST_USER_ID);
    expect(w!.available_balance).toBe(100);

    const { rows } = await ctx.pool.query("SELECT envelope FROM outbox_events WHERE event_type = 'CreditsReturned'");
    expect(rows[0].envelope.payload.reason).toBe('expired');
  });

  it('records a RELEASE ledger entry with positive amount', async () => {
    const orderId = await setupReservation(30);
    await runInTx((c) =>
      handleOrderWithdrawn(c, env<OrderWithdrawnPayload>('OrderWithdrawn', { orderId }), ctx.logger),
    );

    const { rows } = await ctx.pool.query(
      "SELECT amount, balance_after FROM ledger WHERE user_id = $1 AND type = 'RELEASE'", [TEST_USER_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(30);
    expect(rows[0].balance_after).toBe(100);
  });

  it('skips gracefully when no HELD reservation exists', async () => {
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));
    await runInTx((c) =>
      handleOrderWithdrawn(c, env<OrderWithdrawnPayload>('OrderWithdrawn', { orderId: randomUUID() }), ctx.logger),
    );

    const w = await getWallet(TEST_USER_ID);
    expect(w!.available_balance).toBe(100);
  });
});

// ── handleOrderRejected ──

describe('handleOrderRejected', () => {
  async function setupReservation(amount = 30) {
    const orderId = randomUUID();
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));
    await runInTx((c) =>
      handleOrderCreated(c, env<OrderCreatedPayload>('OrderCreated', { orderId, requesterId: TEST_USER_ID, creditAmount: amount }), ctx.logger),
    );
    return orderId;
  }

  it('releases credits back to available', async () => {
    const orderId = await setupReservation(30);
    await runInTx((c) =>
      handleOrderRejected(c, env<OrderRejectedPayload>('OrderRejected', { orderId, requesterId: TEST_USER_ID, reason: 'PENDING_TIMEOUT' }), ctx.logger),
    );

    const w = await getWallet(TEST_USER_ID);
    expect(w!.available_balance).toBe(100);
    expect(w!.reserved_balance).toBe(0);

    const { rows } = await ctx.pool.query('SELECT status, released_at FROM reservations WHERE order_id = $1', [orderId]);
    expect(rows[0].status).toBe('RELEASED');
    expect(rows[0].released_at).not.toBeNull();
  });

  it('records a RELEASE ledger entry with positive amount', async () => {
    const orderId = await setupReservation(30);
    await runInTx((c) =>
      handleOrderRejected(c, env<OrderRejectedPayload>('OrderRejected', { orderId, requesterId: TEST_USER_ID, reason: 'INSUFFICIENT_CREDITS' }), ctx.logger),
    );

    const { rows } = await ctx.pool.query(
      "SELECT amount, balance_after FROM ledger WHERE user_id = $1 AND type = 'RELEASE'", [TEST_USER_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(30);
    expect(rows[0].balance_after).toBe(100);
  });

  it('publishes CreditsReturned outbox event with reason rejected', async () => {
    const orderId = await setupReservation(25);
    await runInTx((c) =>
      handleOrderRejected(c, env<OrderRejectedPayload>('OrderRejected', { orderId, requesterId: TEST_USER_ID, reason: 'PENDING_TIMEOUT' }), ctx.logger),
    );

    const { rows } = await ctx.pool.query("SELECT envelope FROM outbox_events WHERE event_type = 'CreditsReturned'");
    expect(rows).toHaveLength(1);
    expect(rows[0].envelope.payload.reason).toBe('rejected');
  });

  it('skips gracefully when no HELD reservation exists', async () => {
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));
    await runInTx((c) =>
      handleOrderRejected(c, env<OrderRejectedPayload>('OrderRejected', { orderId: randomUUID(), requesterId: TEST_USER_ID, reason: 'PENDING_TIMEOUT' }), ctx.logger),
    );

    const w = await getWallet(TEST_USER_ID);
    expect(w!.available_balance).toBe(100);
  });
});

// ── Credit economy invariant ──

describe('credit economy invariant', () => {
  it('total credits across all wallets equals sum of issuances after a full cycle', async () => {
    // Two users get 100 credits each = 200 total.
    await runInTx((c) => seedWallet(c, TEST_USER_ID, 100));
    await runInTx((c) => seedWallet(c, TEST_RUNNER_ID, 100));

    // User reserves 30 for an order.
    const orderId = randomUUID();
    await runInTx((c) =>
      handleOrderCreated(c, env<OrderCreatedPayload>('OrderCreated', { orderId, requesterId: TEST_USER_ID, creditAmount: 30 }), ctx.logger),
    );

    // Order completes — runner gets 30.
    await runInTx((c) =>
      handleOrderCompleted(c, env<OrderCompletedPayload>('OrderCompleted', { orderId, requesterId: TEST_USER_ID, runnerId: TEST_RUNNER_ID, creditAmount: 30 }), ctx.logger),
    );

    // Total should still be 200.
    const { rows } = await ctx.pool.query(
      'SELECT coalesce(sum(available_balance + reserved_balance), 0)::int AS total FROM wallets',
    );
    expect(rows[0].total).toBe(200);
  });
});
