import { Router } from 'express';
import { requireActiveSession, requireRole } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { orderController } from '../controllers/orderController.js';

/**
 * Every route needs a valid token (401) and a live, non-suspended session (401/403).
 * Whether the caller is requester or runner is checked per order in the service, never from the role.
 */
export function ordersRouter(ctx: AppContext): Router {
  const router = Router();
  const c = orderController(ctx);
  router.use(ctx.auth.requireAuth, requireActiveSession(ctx.sessions));

  router.post('/', c.create);
  router.get('/', c.listOpen);
  // Fixed paths before /:id so "mine" is not read as an order id.
  router.get('/mine', c.listMine);
  router.get('/by-user/:userId', requireRole('admin'), c.listByUser);
  router.get('/:id', c.get);
  router.get('/:id/timeline', c.timeline);

  router.post('/:id/accept', c.changeStatus('accept'));
  router.post('/:id/withdraw', c.changeStatus('withdraw'));
  router.post('/:id/collect', c.changeStatus('collect'));
  router.post('/:id/deliver', c.changeStatus('deliver'));
  router.post('/:id/confirm', c.changeStatus('confirm'));
  router.post('/:id/cancel', c.changeStatus('cancel'));

  return router;
}
