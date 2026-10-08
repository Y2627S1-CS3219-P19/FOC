import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireActiveSession, requireRole } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { walletHistoryQuery, userIdParam, adjustmentBody, balanceAtQuery } from '../schemas.js';
import { withTransaction } from '../db.js';

export function adminRouter(ctx: AppContext): Router {
  const router = Router();
  const { auth, sessions } = ctx;

  // All admin routes require admin role.
  router.use(auth.requireAuth, requireActiveSession(sessions), requireRole('admin'));

  // GET /v1/admin/credits/summary — total credits in circulation
  router.get('/summary', async (_req, res, next) => {
    try {
      const { rows } = await ctx.pool.query(
        `SELECT count(*)::int AS total_wallets,
                coalesce(sum(available_balance), 0)::int AS total_available,
                coalesce(sum(reserved_balance), 0)::int AS total_reserved
         FROM wallets`,
      );
      const r = rows[0] as { total_wallets: number; total_available: number; total_reserved: number };
      res.json({
        data: {
          totalWallets: r.total_wallets,
          totalAvailable: r.total_available,
          totalReserved: r.total_reserved,
          totalCredits: r.total_available + r.total_reserved,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/admin/credits/users/:userId/history — admin view of a user's ledger
  router.get('/users/:userId/history', async (req, res, next) => {
    try {
      const { userId } = userIdParam.parse(req.params);
      const { page, limit, type } = walletHistoryQuery.parse(req.query);
      const offset = (page - 1) * limit;

      const whereClauses = ['user_id = $1'];
      const params: unknown[] = [userId];
      if (type) {
        params.push(type);
        whereClauses.push(`type = $${params.length}`);
      }
      const where = whereClauses.join(' AND ');

      const [{ rows }, { rows: countRows }] = await Promise.all([
        ctx.pool.query(
          `SELECT id, reservation_id, type, amount, balance_after, created_at
           FROM ledger WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
        ctx.pool.query<{ count: string }>(
          `SELECT count(*)::int AS count FROM ledger WHERE ${where}`,
          params,
        ),
      ]);

      const totalItems = Number(countRows[0].count);
      res.json({
        data: rows,
        pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/admin/credits/adjustments — manual credit adjustment
  router.post('/adjustments', async (req, res, next) => {
    try {
      const body = adjustmentBody.parse(req.body);

      const result = await withTransaction(ctx.pool, async (client) => {
        // Lock the wallet row.
        const { rows: walletRows } = await client.query<{ available_balance: number }>(
          'SELECT available_balance FROM wallets WHERE user_id = $1 FOR UPDATE',
          [body.userId],
        );
        if (walletRows.length === 0) {
          return { error: 'WALLET_NOT_FOUND', message: 'User does not have a credit wallet.' } as const;
        }

        const available = walletRows[0].available_balance;
        if (body.amount < 0 && available < Math.abs(body.amount)) {
          return { error: 'INSUFFICIENT_CREDITS', message: `Cannot deduct ${Math.abs(body.amount)}: only ${available} available.` } as const;
        }

        // Update the balance.
        await client.query(
          `UPDATE wallets SET available_balance = available_balance + $1, updated_at = now() WHERE user_id = $2`,
          [body.amount, body.userId],
        );

        const newAvailable = available + body.amount;

        // Record ADJUSTMENT ledger entry.
        await client.query(
          `INSERT INTO ledger (id, user_id, reservation_id, type, amount, balance_after)
           VALUES ($1, $2, NULL, 'ADJUSTMENT', $3, $4)`,
          [randomUUID(), body.userId, body.amount, newAvailable],
        );

        return { userId: body.userId, amount: body.amount, reason: body.reason, balanceAfter: newAvailable } as const;
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

  // GET /v1/admin/credits/reconciliation — reconciliation report
  // Compares total wallet balances against the sum of credit-creating entries
  // (ISSUANCE + ADJUSTMENT). Reserves, settlements, and releases only move
  // credits between users/states — they don't create or destroy credits.
  router.get('/reconciliation', async (_req, res, next) => {
    try {
      const [{ rows: walletRows }, { rows: ledgerRows }] = await Promise.all([
        ctx.pool.query<{ total: number }>(
          `SELECT coalesce(sum(available_balance + reserved_balance), 0)::int AS total FROM wallets`,
        ),
        ctx.pool.query<{ total: number }>(
          `SELECT coalesce(sum(amount), 0)::int AS total FROM ledger WHERE type IN ('ISSUANCE', 'ADJUSTMENT')`,
        ),
      ]);

      const walletTotal = walletRows[0].total;
      const ledgerTotal = ledgerRows[0].total;

      res.json({
        data: {
          walletTotal,
          ledgerTotal,
          healthy: walletTotal === ledgerTotal,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/admin/credits/users/:userId/balance-at — historical balance
  router.get('/users/:userId/balance-at', async (req, res, next) => {
    try {
      const { userId } = userIdParam.parse(req.params);
      const { ts } = balanceAtQuery.parse(req.query);

      const { rows } = await ctx.pool.query<{ balance_after: number }>(
        `SELECT balance_after FROM ledger
         WHERE user_id = $1 AND created_at <= $2
         ORDER BY created_at DESC LIMIT 1`,
        [userId, ts],
      );

      const balance = rows.length > 0 ? rows[0].balance_after : 0;

      res.json({
        data: { userId, timestamp: ts, availableBalance: balance },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
