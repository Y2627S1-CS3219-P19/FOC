import { Router } from 'express';
import type { AppContext } from '../context.js';

export function healthRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/health/live', (_req, res) => {
    res.json({ status: 'UP' });
  });

  router.get('/health/ready', async (_req, res) => {
    const db = await ctx.pool.query('SELECT 1').then(() => true, () => false);
    res.status(db ? 200 : 503).json({ status: db ? 'UP' : 'DOWN', checks: { db } });
  });

  return router;
}
