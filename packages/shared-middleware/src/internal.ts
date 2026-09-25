import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { forbidden, unauthorized } from './errors.js';

export const INTERNAL_AUTH_HEADER = 'X-Internal-Auth';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Guards /v1/internal/* routes (F3.2.4, F6.3, F6.4): only other backend services, identified by the shared
 * secret header, may call them. A request carrying a user's own Bearer token is always rejected.
 */
export function requireInternal(secret: string): RequestHandler {
  return (req, _res, next) => {
    if (req.header('authorization')) {
      return next(forbidden('USER_TOKEN_NOT_ALLOWED', 'Internal endpoints cannot be called with a user session.'));
    }
    const provided = req.header(INTERNAL_AUTH_HEADER);
    if (!provided || !safeEqual(provided, secret)) {
      return next(unauthorized('INTERNAL_AUTH_REQUIRED', 'This endpoint is only available to FoC backend services.'));
    }
    next();
  };
}
