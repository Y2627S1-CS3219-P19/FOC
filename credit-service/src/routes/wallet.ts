import { Router } from 'express';
import { requireActiveSession } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';

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
      const { rows } = await ctx.pool.query(
        `SELECT id, order_id, amount, status, created_at, settled_at, released_at
         FROM reservations WHERE requester_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [userId],
      );
      res.json({ data: rows, pagination: { page: 1, limit: 20, total: rows.length } });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/credits/history — paginated ledger
  router.get('/history', async (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const { rows } = await ctx.pool.query(
        `SELECT id, reservation_id, type, amount, balance_after, created_at
         FROM ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [userId],
      );
      res.json({ data: rows, pagination: { page: 1, limit: 20, total: rows.length } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
