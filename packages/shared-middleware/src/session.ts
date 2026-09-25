import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { forbidden, serviceUnavailable, unauthorized } from './errors.js';
import { INTERNAL_AUTH_HEADER } from './internal.js';
import type { AuthContext } from './auth.js';

/**
 * Result of asking "is this login still valid, and is the account allowed to act?".
 * - active=false  -> the Keycloak session was ended (logout, newer login, suspension, role change)  -> 401
 * - status=suspended -> logged in but suspended by an admin -> 403 ACCOUNT_SUSPENDED (except where allowed)
 */
export interface SessionStatus {
  active: boolean;
  status: 'active' | 'suspended';
  suspensionReason?: string | null;
  adminContact?: string;
}

export type SessionChecker = (auth: AuthContext) => Promise<SessionStatus>;

export interface CachedSessionChecker extends SessionChecker {
  /** Drop cached results for one user, e.g. right after suspending them. */
  purgeUser(userId: string): void;
}

/** Caches checks per token for `ttlMs` (default 5s, the NFR6.1 revocation bound). */
export function cachedSessionChecker(check: SessionChecker, ttlMs = 5_000): CachedSessionChecker {
  const cache = new Map<string, { value: SessionStatus; userId: string; expires: number }>();
  const keyOf = (token: string) => createHash('sha256').update(token).digest('base64url');

  const fn = (async (auth: AuthContext) => {
    const key = keyOf(auth.token);
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.value;
    const value = await check(auth);
    cache.set(key, { value, userId: auth.userId, expires: now + ttlMs });
    if (cache.size > 5_000) {
      for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
    }
    return value;
  }) as CachedSessionChecker;

  fn.purgeUser = (userId: string) => {
    for (const [k, v] of cache) if (v.userId === userId) cache.delete(k);
  };
  return fn;
}

/**
 * Asks the User Service (POST /v1/internal/auth/introspect) - used by Supplier/Order/Credit services.
 * Fails closed: if the User Service cannot be reached the request is rejected with 503.
 */
export function remoteSessionChecker(userServiceUrl: string, internalSecret: string): SessionChecker {
  return async (auth) => {
    let res: Response;
    try {
      res = await fetch(`${userServiceUrl}/v1/internal/auth/introspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [INTERNAL_AUTH_HEADER]: internalSecret },
        body: JSON.stringify({ token: auth.token }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw serviceUnavailable('AUTH_SERVICE_UNAVAILABLE', 'Cannot verify your session right now. Please try again.');
    }
    if (!res.ok) throw serviceUnavailable('AUTH_SERVICE_UNAVAILABLE', 'Cannot verify your session right now. Please try again.');
    const body = (await res.json()) as { data: SessionStatus };
    return body.data;
  };
}

export interface ActiveSessionOptions {
  /** Let suspended users through (only for GET /users/me so they can read the suspension notice, F3.1.4). */
  allowSuspended?: boolean;
}

/** Must run after requireAuth. Rejects revoked sessions (401) and suspended accounts (403). */
export function requireActiveSession(checker: SessionChecker, options: ActiveSessionOptions = {}): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.auth) throw unauthorized();
      const status = await checker(req.auth);
      if (!status.active) throw unauthorized('SESSION_REVOKED', 'Your session has ended. Please log in again.');
      req.accountStatus = status.status;
      if (status.status === 'suspended' && !options.allowSuspended) {
        throw forbidden('ACCOUNT_SUSPENDED', 'Your account is suspended. Contact an administrator.', {
          reason: status.suspensionReason ?? null,
          adminContact: status.adminContact ?? null,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
