import { Router } from 'express';
import { requireActiveSession, requireRole } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { walletHistoryQuery, userIdParam } from '../schemas.js';

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
