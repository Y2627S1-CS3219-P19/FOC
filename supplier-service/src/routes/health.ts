import type { FastifyPluginAsync } from 'fastify';

export interface HealthRouteOptions {
  checkDbReady?: () => Promise<boolean> | boolean;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (fastify, opts) => {
  fastify.get('/health/live', async (_req, reply) => {
    return reply.status(200).send({ status: 'UP' });
  });

  fastify.get('/health/ready', async (_req, reply) => {
    const isReady = opts.checkDbReady ? await opts.checkDbReady() : true;
    if (isReady) {
      return reply.status(200).send({ status: 'UP', checks: { db: true } });
    } else {
      return reply.status(503).send({ status: 'DOWN', checks: { db: false } });
    }
  });
};
