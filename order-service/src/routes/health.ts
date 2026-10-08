import { Router } from 'express';
import type { AppContext } from '../context.js';
import { outboxStats } from '../repositories/outboxRepository.js';

type BrokerState = 'UP' | 'DOWN' | 'DISABLED';

function brokerState(ctx: AppContext): BrokerState {
  if (!ctx.broker) return 'DISABLED';
  return ctx.broker.isConnected() ? 'UP' : 'DOWN';
}

/** Not routed by nginx, so only reachable inside the Docker network. */
export function healthRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/health/live', (_req, res) => {
    res.json({ status: 'UP' });
  });

  // Only the DB decides readiness. With RabbitMQ down, orders still work and events wait in the outbox,
  // so the service reports DEGRADED but stays in rotation.
  router.get('/health/ready', async (_req, res) => {
    const db = await ctx.pool.query('SELECT 1').then(() => true, () => false);
    const broker = brokerState(ctx);
    const status = !db ? 'DOWN' : broker === 'DOWN' ? 'DEGRADED' : 'UP';
    res.status(db ? 200 : 503).json({ status, checks: { db, broker } });
  });

  router.get('/metrics', async (_req, res) => {
    const dlqDepth = ctx.broker ? await ctx.broker.dlqDepth().catch(() => null) : null;
    res.json({ broker: brokerState(ctx), outbox: await outboxStats(ctx.pool), deadLetterQueue: { depth: dlqDepth } });
  });

  return router;
}
