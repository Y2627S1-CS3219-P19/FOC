import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Logger } from 'pino';
import {
  CREDIT_EVENTS,
  type EventEnvelope,
  type OrderCreatedPayload,
  type OrderCompletedPayload,
  type OrderWithdrawnPayload,
  type OrderCancelledPayload,
  type OrderExpiredPayload,
  addOutboxEvent,
} from '@foc/shared-events';

export async function handleOrderCreated(
  client: PoolClient,
  envelope: EventEnvelope<OrderCreatedPayload>,
  log: Logger,
): Promise<void> {
  const { orderId, requesterId, creditAmount } = envelope.payload;

  // Idempotent: skip if reservation already exists for this order.
  const { rows: existing } = await client.query(
    'SELECT id FROM reservations WHERE order_id = $1',
    [orderId],
  );
  if (existing.length > 0) {
    log.info({ orderId }, 'Reservation already exists for order; skipping');
    return;
  }

  // Lock the wallet row.
  const { rows: walletRows } = await client.query<{ available_balance: number }>(
    'SELECT available_balance FROM wallets WHERE user_id = $1 FOR UPDATE',
    [requesterId],
  );
  if (walletRows.length === 0) {
    log.error({ orderId, requesterId }, 'OrderCreated: wallet not found for requester');
    await addOutboxEvent(client, CREDIT_EVENTS.reservationFailed, {
      orderId, requesterId, amount: creditAmount, availableBalance: null, reason: 'NO_WALLET',
    }, envelope.correlationId);
    return;
  }

  const available = walletRows[0].available_balance;
  if (available < creditAmount) {
    log.error({ orderId, requesterId, available, required: creditAmount }, 'OrderCreated: insufficient credits');
    await addOutboxEvent(client, CREDIT_EVENTS.reservationFailed, {
      orderId, requesterId, amount: creditAmount, availableBalance: available, reason: 'INSUFFICIENT_CREDITS',
    }, envelope.correlationId);
    return;
  }

  // Debit available, credit reserved.
  await client.query(
    `UPDATE wallets
       SET available_balance = available_balance - $1,
           reserved_balance  = reserved_balance  + $1,
           updated_at = now()
     WHERE user_id = $2`,
    [creditAmount, requesterId],
  );

  // Create reservation.
  const reservationId = randomUUID();
  await client.query(
    `INSERT INTO reservations (id, order_id, requester_id, amount, status)
     VALUES ($1, $2, $3, $4, 'HELD')`,
    [reservationId, orderId, requesterId, creditAmount],
  );

  // Record RESERVE ledger entry.
  const newAvailable = available - creditAmount;
  await client.query(
    `INSERT INTO ledger (id, user_id, reservation_id, type, amount, balance_after)
     VALUES ($1, $2, $3, 'RESERVE', $4, $5)`,
    [randomUUID(), requesterId, reservationId, -creditAmount, newAvailable],
  );

  // Publish CreditsReserved event via outbox.
  await addOutboxEvent(client, CREDIT_EVENTS.reserved, {
    orderId,
    requesterId,
    amount: creditAmount,
  }, envelope.correlationId);

  log.info({ orderId, requesterId, amount: creditAmount }, 'Credits reserved for order');
}

export async function handleOrderCompleted(
  client: PoolClient,
  envelope: EventEnvelope<OrderCompletedPayload>,
  log: Logger,
): Promise<void> {
  const { orderId, requesterId, runnerId } = envelope.payload;

  // Find the HELD reservation for this order.
  const { rows: resRows } = await client.query<{ id: string; amount: number }>(
    `SELECT id, amount FROM reservations WHERE order_id = $1 AND status = 'HELD'`,
    [orderId],
  );
  if (resRows.length === 0) {
    log.warn({ orderId }, 'OrderCompleted: no HELD reservation found; skipping');
    return;
  }
  const reservation = resRows[0];

  // Settle the reservation.
  await client.query(
    `UPDATE reservations SET status = 'SETTLED', settled_at = now() WHERE id = $1`,
    [reservation.id],
  );

  // Debit the requester's reserved balance.
  await client.query(
    `UPDATE wallets
       SET reserved_balance = reserved_balance - $1,
           updated_at = now()
     WHERE user_id = $2`,
    [reservation.amount, requesterId],
  );

  // Get requester's new available balance for ledger snapshot.
  const { rows: reqWallet } = await client.query<{ available_balance: number }>(
    'SELECT available_balance FROM wallets WHERE user_id = $1',
    [requesterId],
  );
  const reqBalanceAfter = reqWallet[0].available_balance;

  // Record SETTLE_DEBIT ledger entry for requester (credits leave reserved, amount is negative).
  await client.query(
    `INSERT INTO ledger (id, user_id, reservation_id, type, amount, balance_after)
     VALUES ($1, $2, $3, 'SETTLE_DEBIT', $4, $5)`,
    [randomUUID(), requesterId, reservation.id, -reservation.amount, reqBalanceAfter],
  );

  // Credit the runner's available balance.
  await client.query(
    `UPDATE wallets
       SET available_balance = available_balance + $1,
           updated_at = now()
     WHERE user_id = $2`,
    [reservation.amount, runnerId],
  );

  // Get runner's new available balance for ledger snapshot.
  const { rows: runWallet } = await client.query<{ available_balance: number }>(
    'SELECT available_balance FROM wallets WHERE user_id = $1',
    [runnerId],
  );
  const runBalanceAfter = runWallet[0].available_balance;

  // Record SETTLE_CREDIT ledger entry for runner.
  await client.query(
    `INSERT INTO ledger (id, user_id, reservation_id, type, amount, balance_after)
     VALUES ($1, $2, $3, 'SETTLE_CREDIT', $4, $5)`,
    [randomUUID(), runnerId, reservation.id, reservation.amount, runBalanceAfter],
  );

  // Publish CreditsReleased event via outbox.
  await addOutboxEvent(client, CREDIT_EVENTS.released, {
    orderId,
    requesterId,
    runnerId,
    amount: reservation.amount,
  }, envelope.correlationId);

  log.info({ orderId, requesterId, runnerId, amount: reservation.amount }, 'Credits settled for completed order');
}

async function releaseCredits(
  client: PoolClient,
  orderId: string,
  reason: string,
  correlationId: string | null,
  log: Logger,
): Promise<void> {
  // Find the HELD reservation.
  const { rows: resRows } = await client.query<{ id: string; requester_id: string; amount: number }>(
    `SELECT id, requester_id, amount FROM reservations WHERE order_id = $1 AND status = 'HELD'`,
    [orderId],
  );
  if (resRows.length === 0) {
    log.warn({ orderId, reason }, 'Release: no HELD reservation found; skipping');
    return;
  }
  const reservation = resRows[0];

  // Release the reservation.
  await client.query(
    `UPDATE reservations SET status = 'RELEASED', released_at = now() WHERE id = $1`,
    [reservation.id],
  );

  // Return credits: debit reserved, credit available.
  await client.query(
    `UPDATE wallets
       SET reserved_balance  = reserved_balance  - $1,
           available_balance = available_balance + $1,
           updated_at = now()
     WHERE user_id = $2`,
    [reservation.amount, reservation.requester_id],
  );

  // Get new available balance for ledger snapshot.
  const { rows: wallet } = await client.query<{ available_balance: number }>(
    'SELECT available_balance FROM wallets WHERE user_id = $1',
    [reservation.requester_id],
  );
  const balanceAfter = wallet[0].available_balance;

  // Record RELEASE ledger entry (positive — credits returned).
  await client.query(
    `INSERT INTO ledger (id, user_id, reservation_id, type, amount, balance_after)
     VALUES ($1, $2, $3, 'RELEASE', $4, $5)`,
    [randomUUID(), reservation.requester_id, reservation.id, reservation.amount, balanceAfter],
  );

  // Publish CreditsReturned event via outbox.
  await addOutboxEvent(client, CREDIT_EVENTS.returned, {
    orderId,
    requesterId: reservation.requester_id,
    amount: reservation.amount,
    reason,
  }, correlationId);

  log.info({ orderId, requesterId: reservation.requester_id, amount: reservation.amount, reason }, 'Credits released');
}

export async function handleOrderWithdrawn(
  client: PoolClient,
  envelope: EventEnvelope<OrderWithdrawnPayload>,
  log: Logger,
): Promise<void> {
  await releaseCredits(client, envelope.payload.orderId, 'withdrawn', envelope.correlationId, log);
}

export async function handleOrderCancelled(
  client: PoolClient,
  envelope: EventEnvelope<OrderCancelledPayload>,
  log: Logger,
): Promise<void> {
  await releaseCredits(client, envelope.payload.orderId, 'cancelled', envelope.correlationId, log);
}

export async function handleOrderExpired(
  client: PoolClient,
  envelope: EventEnvelope<OrderExpiredPayload>,
  log: Logger,
): Promise<void> {
  await releaseCredits(client, envelope.payload.orderId, 'expired', envelope.correlationId, log);
}
