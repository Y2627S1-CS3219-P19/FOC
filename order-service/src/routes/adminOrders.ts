import { Router } from 'express';
import { requireActiveSession, requireRole } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { orderController } from '../controllers/orderController.js';

/** Admin-only order views, mounted at /v1/admin/orders (the gateway routes that prefix here). */
export function adminOrdersRouter(ctx: AppContext): Router {
  const router = Router();
  const c = orderController(ctx);
  router.use(ctx.auth.requireAuth, requireActiveSession(ctx.sessions), requireRole('admin'));

  router.get('/', c.listAll);

  return router;
}
