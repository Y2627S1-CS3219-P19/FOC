import { Router } from 'express';
import { requireActiveSession } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { reservationsQuery, walletHistoryQuery } from '../schemas.js';

export function walletRouter(ctx: AppContext): Router {
  const router = Router();
  const { auth, sessions } = ctx;

  // All wallet routes require an authenticated, active session.
  router.use(auth.requireAuth, requireActiveSession(sessions));

  // GET /v1/credits/wallet — current balance
  router.get('/wallet', async (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const { rows } = await ctx.pool.query(
        'SELECT available_balance, reserved_balance FROM wallets WHERE user_id = $1',
        [userId],
      );
      if (rows.length === 0) {
        return res.json({ data: { userId, availableBalance: 0, reservedBalance: 0, totalBalance: 0 } });
      }
      const w = rows[0] as { available_balance: number; reserved_balance: number };
      res.json({
        data: {
          userId,
          availableBalance: w.available_balance,
          reservedBalance: w.reserved_balance,
          totalBalance: w.available_balance + w.reserved_balance,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/credits/reservations — orders with held credits
  router.get('/reservations', async (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const { page, limit, status } = reservationsQuery.parse(req.query);
      const offset = (page - 1) * limit;

      const whereClauses = ['requester_id = $1'];
      const params: unknown[] = [userId];
      if (status) {
        params.push(status);
        whereClauses.push(`status = $${params.length}`);
      }
      const where = whereClauses.join(' AND ');

      const [{ rows }, { rows: countRows }] = await Promise.all([
        ctx.pool.query(
          `SELECT id, order_id, amount, status, created_at, settled_at, released_at
           FROM reservations WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
        ctx.pool.query<{ count: string }>(
          `SELECT count(*)::int AS count FROM reservations WHERE ${where}`,
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

  // GET /v1/credits/history — paginated ledger
  router.get('/history', async (req, res, next) => {
    try {
      const userId = req.auth!.userId;
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

  return router;
}
