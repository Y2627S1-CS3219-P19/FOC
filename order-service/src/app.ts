import express from 'express';
import { correlationId, errorHandler, httpLogger, notFoundHandler } from '@foc/shared-middleware';
import type { AppContext } from './context.js';
import { healthRouter } from './routes/health.js';
import { ordersRouter } from './routes/orders.js';

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable('x-powered-by');
  if (ctx.config.trustProxy) app.set('trust proxy', ctx.config.trustProxy);

  app.use(correlationId);
  app.use(httpLogger(ctx.logger));
  app.use(express.json({ limit: '100kb' }));

  app.use(healthRouter(ctx));
  app.use('/v1/orders', ordersRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler(ctx.logger));
  return app;
}
