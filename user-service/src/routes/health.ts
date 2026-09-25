import { Router } from 'express';
import type { AppContext } from '../context.js';

export function healthRouter(ctx: AppContext): Router {
  const router = Router();
  router.get('/health/live', (_req, res) => {
    res.json({ status: 'UP' });
  });
  router.get('/health/ready', async (_req, res) => {
    const [db, keycloak] = await Promise.all([
      ctx.pool.query('SELECT 1').then(() => true, () => false),
      ctx.kc.ping(),
    ]);
    res.status(db && keycloak ? 200 : 503).json({ status: db && keycloak ? 'UP' : 'DOWN', checks: { db, keycloak } });
  });
  return router;
}
