import { Router } from 'express';
import { parseOrThrow, requireInternal } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { idParamSchema } from '../schemas.js';
import { findSupplier } from '../suppliers.js';

/** Service-to-service routes; only callable with X-Internal-Auth, never with a user token. */
export function internalRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireInternal(ctx.config.internalAuthSecret));

  // F10A: the Order Service checks a supplier exists, is active and is open now before creating an order,
  // and copies the returned details into the order as a snapshot.
  router.get('/suppliers/:id/validate', async (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    const s = await findSupplier(ctx.pool, id, ctx.config.timezone);
    const exists = !!s;
    const isActive = !!s?.is_active;
    const isOpenNow = isActive && !!s?.is_open_now;
    res.json({
      data: {
        exists,
        isActive,
        isOpenNow,
        valid: exists && isActive && isOpenNow,
        reason: !exists ? 'NOT_FOUND' : !isActive ? 'INACTIVE' : !isOpenNow ? 'CLOSED' : null,
        supplier: s
          ? {
              id: s.id,
              name: s.name,
              facilityType: s.facility_type,
              building: s.building,
              floor: s.floor,
              locationDescription: s.location_description,
              opensAt: s.opens_at.slice(0, 5),
              closesAt: s.closes_at.slice(0, 5),
            }
          : null,
      },
    });
  });

  return router;
}
