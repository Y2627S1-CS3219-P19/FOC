import { cachedSessionChecker, type CachedSessionChecker } from '@foc/shared-middleware';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import type { KeycloakAdmin } from './keycloak.js';
import { findUserById } from './users.js';

/**
 * "Is this login still valid, and may the account act?" - checked on every protected request.
 * 1. Keycloak introspection: false after logout, a newer login (single session), suspension or role change.
 * 2. Our users.status: suspended accounts can still log in, but may only read their own profile.
 * Cached for 5 seconds per token (NFR6.1 bound). Also answers other services via /v1/internal/auth/introspect.
 */
export function createSessionChecker(deps: { kc: KeycloakAdmin; pool: Pool; config: Config }): CachedSessionChecker {
  return cachedSessionChecker(async (auth) => {
    const active = await deps.kc.introspect(auth.token);
    if (!active) return { active: false, status: 'active' };
    const user = await findUserById(deps.pool, auth.userId);
    return {
      active: true,
      status: user?.status ?? 'active',
      suspensionReason: user?.suspension_reason ?? null,
      adminContact: deps.config.adminContactEmail,
    };
  });
}
