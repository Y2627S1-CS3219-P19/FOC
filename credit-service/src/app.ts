import { readFileSync } from 'node:fs';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse as parseYaml } from 'yaml';
import { correlationId, errorHandler, httpLogger, notFoundHandler } from '@foc/shared-middleware';
import type { AppContext } from './context.js';
import { healthRouter } from './routes/health.js';
import { walletRouter } from './routes/wallet.js';
import { adminRouter } from './routes/admin.js';
import { internalRouter } from './routes/internal.js';

const openapi = parseYaml(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as object;

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable('x-powered-by');
  if (ctx.config.trustProxy) app.set('trust proxy', ctx.config.trustProxy);

  app.use(correlationId);
  app.use(httpLogger(ctx.logger));
  app.use(express.json({ limit: '100kb' }));

  app.use(healthRouter(ctx));
  app.use('/v1/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'FoC Credit Service API' }));
  app.get('/v1/openapi.json', (_req, res) => {
    res.json(openapi);
  });

  app.use('/v1/credits', walletRouter(ctx));
  app.use('/v1/admin/credits', adminRouter(ctx));
  app.use('/v1/internal/credits', internalRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler(ctx.logger));
  return app;
}
