import { Router } from 'express';
import { requireInternal } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { reserveBody } from '../schemas.js';

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

      // Stub: return 501 until the full reserve logic is implemented
      res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Credit reservation is not yet fully implemented.' } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
