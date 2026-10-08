import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireInternal } from '@foc/shared-middleware';
import { CREDIT_EVENTS, addOutboxEvent } from '@foc/shared-events';
import type { AppContext } from '../context.js';
import { reserveBody } from '../schemas.js';
import { withTransaction } from '../db.js';

export function internalRouter(ctx: AppContext): Router {
  const router = Router();

  router.use(requireInternal(ctx.config.internalAuthSecret));

  // POST /v1/internal/credits/reserve — idempotent credit reservation for an order
  router.post('/reserve', async (req, res, next) => {
    try {
      const body = reserveBody.parse(req.body);

      // Check for existing reservation (idempotent on orderId)
      const { rows: existing } = await ctx.pool.query(
        'SELECT id, status, amount FROM reservations WHERE order_id = $1',
        [body.orderId],
      );
      if (existing.length > 0) {
        const r = existing[0] as { id: string; status: string; amount: number };
        return res.json({ data: { reservationId: r.id, orderId: body.orderId, amount: r.amount, status: r.status } });
      }

      const result = await withTransaction(ctx.pool, async (client) => {
        // Lock the wallet row to prevent concurrent reservations.
        const { rows: walletRows } = await client.query<{ available_balance: number }>(
          'SELECT available_balance FROM wallets WHERE user_id = $1 FOR UPDATE',
          [body.requesterId],
        );
        if (walletRows.length === 0) {
          return { error: 'WALLET_NOT_FOUND', message: 'Requester does not have a credit wallet.' } as const;
        }

        const available = walletRows[0].available_balance;
        if (available < body.amount) {
          return { error: 'INSUFFICIENT_CREDITS', message: `Insufficient credits: available ${available}, required ${body.amount}.` } as const;
        }

        // Debit available, credit reserved.
        await client.query(
          `UPDATE wallets
             SET available_balance = available_balance - $1,
                 reserved_balance  = reserved_balance  + $1,
                 updated_at = now()
           WHERE user_id = $2`,
          [body.amount, body.requesterId],
        );

        // Create the reservation.
        const reservationId = randomUUID();
        await client.query(
          `INSERT INTO reservations (id, order_id, requester_id, amount, status)
           VALUES ($1, $2, $3, $4, 'HELD')`,
          [reservationId, body.orderId, body.requesterId, body.amount],
        );

        // Record RESERVE ledger entry.
        const newAvailable = available - body.amount;
        await client.query(
          `INSERT INTO ledger (id, user_id, reservation_id, type, amount, balance_after)
           VALUES ($1, $2, $3, 'RESERVE', $4, $5)`,
          [randomUUID(), body.requesterId, reservationId, -body.amount, newAvailable],
        );

        // Publish CreditsReserved event via outbox.
        await addOutboxEvent(client, CREDIT_EVENTS.reserved, {
          orderId: body.orderId,
          requesterId: body.requesterId,
          amount: body.amount,
        });

        return { reservationId, orderId: body.orderId, amount: body.amount, status: 'HELD' } as const;
      });

      if ('error' in result) {
        const status = result.error === 'WALLET_NOT_FOUND' ? 404 : 422;
        return res.status(status).json({ error: { code: result.error, message: result.message } });
      }

      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
