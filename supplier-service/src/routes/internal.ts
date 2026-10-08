import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { unauthorized, forbidden } from '../middleware/errors.js';
import type { SupplierRepository } from '../db/repository.js';
import { idParamSchema } from '../schemas/supplier.js';

export interface InternalRoutesOptions {
  repository: SupplierRepository;
  internalAuthSecret?: string;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const internalRoutes: FastifyPluginAsync<InternalRoutesOptions> = async (fastify, opts) => {
  const repo = opts.repository;
  const secret = opts.internalAuthSecret ?? process.env.INTERNAL_AUTH_SECRET ?? 'test-internal-secret';

  // Guard all /v1/internal/* routes
  fastify.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.headers.authorization) {
      throw forbidden('USER_TOKEN_NOT_ALLOWED', 'Internal endpoints cannot be called with a user session.');
    }

    const provided = req.headers['x-internal-auth'] as string | undefined;
    if (!provided || !safeEqual(provided, secret)) {
      throw unauthorized('INTERNAL_AUTH_REQUIRED', 'This endpoint is only available to FoC backend services.');
    }
  });

  fastify.get('/suppliers/:id/validate', async (req, _reply) => {
    const { id } = idParamSchema.parse(req.params);
    const s = await repo.findById(id);

    const exists = !!s;
    const isActive = !!s?.isActive;
    const isOpenNow = !!s?.isOpenNow;
    const valid = exists && isActive && isOpenNow;
    const reason = !exists ? 'NOT_FOUND' : !isActive ? 'INACTIVE' : !isOpenNow ? 'CLOSED' : null;

    return {
      data: {
        exists,
        isActive,
        isOpenNow,
        valid,
        reason,
        supplier: s
          ? {
              id: s.id,
              name: s.name,
              facilityType: s.facilityType,
              building: s.building,
              floor: s.floor,
              locationDescription: s.locationDescription,
              opensAt: s.opensAt.slice(0, 5),
              closesAt: s.closesAt.slice(0, 5),
            }
          : null,
      },
    };
  });
};
