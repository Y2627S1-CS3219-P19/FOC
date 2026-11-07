import { Router } from 'express';
import type { AppContext } from '../context.js';

export function healthRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/health/live', (_req, res) => {
    res.json({ status: 'ok', service: 'faq-service' });
  });

  // Ready = the Chroma store answers. Liveness is static so the orchestrator can restart us.
  router.get('/health/ready', async (_req, res) => {
    try {
      await ctx.pingStore();
      res.json({ status: 'ok', store: ctx.config.chromaUrl });
    } catch (err) {
      res.status(503).json({ status: 'unavailable', store: ctx.config.chromaUrl });
      ctx.logger.warn({ err }, 'Chroma not reachable');
    }
  });

  return router;
}
