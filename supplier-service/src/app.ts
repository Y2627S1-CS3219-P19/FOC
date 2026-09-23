import { readFileSync } from 'node:fs';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse as parseYaml } from 'yaml';
import { correlationId, errorHandler, httpLogger, notFoundHandler } from '@foc/shared-middleware';
import type { AppContext } from './context.js';
import { internalRouter } from './routes/internal.js';
import { suppliersRouter } from './routes/suppliers.js';

const openapi = parseYaml(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as object;

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable('x-powered-by');
  app.use(correlationId);
  app.use(httpLogger(ctx.logger));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'UP' });
  });
  app.get('/health/ready', async (_req, res) => {
    const db = await ctx.pool.query('SELECT 1').then(() => true, () => false);
    res.status(db ? 200 : 503).json({ status: db ? 'UP' : 'DOWN', checks: { db } });
  });

  app.use('/v1/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'FoC Supplier Service API' }));
  app.get('/v1/openapi.json', (_req, res) => {
    res.json(openapi);
  });

  // Supplier photos are public: <img> tags cannot send a Bearer token, and the images are not sensitive.
  app.use('/v1/supplier-images', express.static(ctx.config.imagesDir, { maxAge: '1h', fallthrough: false }));

  app.use('/v1/suppliers', suppliersRouter(ctx));
  app.use('/v1/internal', internalRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler(ctx.logger));
  return app;
}
