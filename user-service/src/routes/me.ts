import { Router, type Request } from 'express';
import { conflict, parseOrThrow, requireActiveSession, unauthorized } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { mapUniqueViolation } from '../db.js';
import { profileUpdateSchema } from '../schemas.js';
import { findUserById, insertUser, toProfile, type UserRow } from '../users.js';

/**
 * Loads the caller's users row. If Keycloak knows the user but we do not (e.g. created in the Keycloak console),
 * create the row just-in-time from the verified token.
 */
async function loadOrProvisionSelf(ctx: AppContext, req: Request): Promise<UserRow> {
  const auth = req.auth;
  if (!auth) throw unauthorized();
  const existing = await findUserById(ctx.pool, auth.userId);
  if (existing) return existing;
  if (!auth.username || !auth.email) throw conflict('PROFILE_INCOMPLETE', 'Your login has no username or email.');
  try {
    return await insertUser(ctx.pool, {
      id: auth.userId,
      username: auth.username,
      email: auth.email,
      displayName: auth.username,
      role: auth.roles.includes('admin') ? 'admin' : 'user',
    });
  } catch (err) {
    const again = await findUserById(ctx.pool, auth.userId); // lost a race with a parallel request
    if (again) return again;
    throw mapUniqueViolation(err);
  }
}

export function meRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(ctx.auth.requireAuth);

  // F3.1: own profile. Suspended users may read this so they can see the notice + admin contact (F3.1.4, F3.1.4.1).
  router.get('/me', requireActiveSession(ctx.sessions, { allowSuspended: true }), async (req, res) => {
    const user = await loadOrProvisionSelf(ctx, req);
    res.json({
      data: {
        ...toProfile(user),
        roles: req.auth!.roles.filter((r) => r === 'user' || r === 'admin'),
        suspension:
          user.status === 'suspended'
            ? { reason: user.suspension_reason, since: user.suspended_at, adminContact: ctx.config.adminContactEmail }
            : null,
      },
    });
  });

  // F4.1: update own profile. Only whitelisted fields; anything else (role, status, id...) -> 422.
  router.patch('/me', requireActiveSession(ctx.sessions), async (req, res) => {
    const input = parseOrThrow(profileUpdateSchema, req.body, 'Some fields cannot be updated.');
    await loadOrProvisionSelf(ctx, req);
    const sets: string[] = [];
    const values: unknown[] = [req.auth!.userId];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (input.displayName !== undefined) add('display_name', input.displayName);
    if (input.contactNumber !== undefined) add('contact_number', input.contactNumber);
    if (input.defaultDeliveryLocation !== undefined) add('default_delivery_location', input.defaultDeliveryLocation);
    const { rows } = await ctx.pool.query<UserRow>(
      `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      values,
    );
    res.json({ data: toProfile(rows[0]!) });
  });

  return router;
}
