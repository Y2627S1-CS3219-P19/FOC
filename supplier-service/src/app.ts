import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { imageRoutes } from './routes/images.js';
import { supplierRoutes } from './routes/suppliers.js';
import { errorHandler } from './middleware/errors.js';
import authPlugin, { type AuthPluginOptions } from './middleware/auth.js';
import { InMemorySupplierRepository, type SupplierRepository } from './db/repository.js';

export interface AppOptions {
  dbReady?: boolean;
  imagesDir?: string;
  authConfig?: AuthPluginOptions;
  repository?: SupplierRepository;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  app.setErrorHandler(errorHandler);
  await app.register(cors);

  // Correlation ID hook: pass through or generate
  app.addHook('onRequest', async (req, reply) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || crypto.randomUUID();
    reply.header('x-correlation-id', correlationId);
  });

  // Register authentication plugin
  await app.register(authPlugin, opts.authConfig ?? {});

  // Register health routes
  await app.register(healthRoutes, {
    checkDbReady: () => opts.dbReady ?? true,
  });

  // Register public images route
  const imagesDir = opts.imagesDir ?? path.resolve(process.cwd(), '../data/images');
  await app.register(imageRoutes, { imagesDir });

  // Register supplier routes
  const repository = opts.repository ?? new InMemorySupplierRepository();
  await app.register(supplierRoutes, {
    prefix: '/v1/suppliers',
    repository,
  });

  return app;
}
