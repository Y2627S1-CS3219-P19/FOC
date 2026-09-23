import { Router } from 'express';
import { AppError, notFound, parseOrThrow, requireInternal } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { idParamSchema, introspectSchema } from '../schemas.js';
import { findUserById, toSummary } from '../users.js';

/** Service-to-service routes (F3.2, F6.3, F6.4, F6.7). Need X-Internal-Auth; user tokens are rejected. */
export function internalRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireInternal(ctx.config.internalAuthSecret));

  // F3.2: public-safe user summary for Order/Credit services. No email, phone, location or credentials.
  router.get('/users/:id/summary', async (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    const user = await findUserById(ctx.pool, id);
    if (!user) throw notFound('USER_NOT_FOUND', 'User not found.');
    res.json({ data: toSummary(user) });
  });

  // Lets other services check a user's token: signature + live Keycloak session + not suspended (NFR6.1).
  router.post('/auth/introspect', async (req, res) => {
    const { token } = parseOrThrow(introspectSchema, req.body);
    let auth;
    try {
      auth = await ctx.auth.verify(token);
    } catch (err) {
      if (err instanceof AppError && err.status === 401) {
        res.json({ data: { active: false, status: 'active', reason: err.code } });
        return;
      }
      throw err;
    }
    const status = await ctx.sessions(auth);
    res.json({ data: { ...status, userId: auth.userId, roles: auth.roles } });
  });

  return router;
}
