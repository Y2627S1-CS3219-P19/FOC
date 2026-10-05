import { Router } from 'express';
import { requireActiveSession, requireRole } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';

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
      const { userId } = req.params;
      const { rows } = await ctx.pool.query(
        `SELECT id, reservation_id, type, amount, balance_after, created_at
         FROM ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId],
      );
      res.json({ data: rows, pagination: { page: 1, limit: 50, total: rows.length } });
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/admin/credits/adjustments — manual credit adjustment
  router.post('/adjustments', (_req, res) => {
    res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Credit adjustments are not yet implemented.' } });
  });

  // GET /v1/admin/credits/reconciliation — reconciliation report
  router.get('/reconciliation', (_req, res) => {
    res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Reconciliation is not yet implemented.' } });
  });

  // GET /v1/admin/credits/users/:userId/balance-at — historical balance
  router.get('/users/:userId/balance-at', (_req, res) => {
    res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Historical balance queries are not yet implemented.' } });
  });

  return router;
}
