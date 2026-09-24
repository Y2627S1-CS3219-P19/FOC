import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { createRemoteJWKSet, jwtVerify, createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { unauthorized, forbidden, serviceUnavailable } from './errors.js';

export interface AuthContext {
  userId: string;
  roles: string[];
  email?: string;
  token: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface AuthPluginOptions {
  jwksUri?: string;
  issuer?: string;
  getJwksKeys?: () => Promise<any[]>;
  introspectFn?: (token: string, internalSecret: string) => Promise<{ status: number; body: any }>;
  userServiceUrl?: string;
  internalAuthSecret?: string;
}

interface CacheEntry {
  expiresAt: number;
  active: boolean;
  reason?: string;
}

export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  const issuer = opts.issuer ?? 'http://localhost:8080/realms/campuserrand';
  const internalSecret = opts.internalAuthSecret ?? process.env.INTERNAL_AUTH_SECRET ?? 'test-internal-secret';
  const userServiceUrl = opts.userServiceUrl ?? process.env.USER_SERVICE_URL ?? 'http://user-service:3001';

  let keySet: any;
  if (opts.getJwksKeys) {
    const keys = await opts.getJwksKeys();
    keySet = createLocalJWKSet({ keys } as JSONWebKeySet);
  } else if (opts.jwksUri) {
    keySet = createRemoteJWKSet(new URL(opts.jwksUri));
  } else {
    const defaultJwks = `${issuer}/protocol/openid-connect/certs`;
    keySet = createRemoteJWKSet(new URL(defaultJwks));
  }

  // 5-second in-memory cache for user service introspection
  const introspectCache = new Map<string, CacheEntry>();

  async function checkIntrospection(token: string): Promise<{ active: boolean; reason?: string }> {
    const cached = introspectCache.get(token);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return { active: cached.active, reason: cached.reason };
    }

    try {
      let status: number;
      let body: any;

      if (opts.introspectFn) {
        const res = await opts.introspectFn(token, internalSecret);
        status = res.status;
        body = res.body;
      } else {
        const response = await fetch(`${userServiceUrl}/v1/internal/auth/introspect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': internalSecret,
          },
          body: JSON.stringify({ token }),
        });
        status = response.status;
        body = await response.json().catch(() => ({}));
      }

      if (status >= 500) {
        throw new Error(`User service returned ${status}`);
      }

      // Unpack response envelope { data: ... } or flat response
      const data = body.data ?? body;
      const isSuspended = data.status === 'suspended' || data.reason === 'ACCOUNT_SUSPENDED';
      const active = data.active === true && !isSuspended;
      const reason = isSuspended ? 'ACCOUNT_SUSPENDED' : data.reason;

      introspectCache.set(token, {
        expiresAt: now + 5000,
        active,
        reason,
      });

      return { active, reason };
    } catch {
      throw serviceUnavailable('AUTH_SERVICE_UNAVAILABLE', 'Authentication service unavailable');
    }
  }

  fastify.decorate('requireAuth', async (req: FastifyRequest, _reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw unauthorized('TOKEN_MISSING', 'Authorization Bearer token is required');
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw unauthorized('TOKEN_MISSING', 'Authorization Bearer token is required');
    }

    let payload: any;
    try {
      const verified = await jwtVerify(token, keySet, { issuer });
      payload = verified.payload;
    } catch (err: any) {
      if (err?.code === 'ERR_JWT_EXPIRED') {
        throw unauthorized('TOKEN_EXPIRED', 'Access token has expired');
      }
      throw unauthorized('TOKEN_INVALID', 'Token signature or issuer is invalid');
    }

    // Two-tier check: session introspection with User Service
    const session = await checkIntrospection(token);
    if (!session.active) {
      if (session.reason === 'ACCOUNT_SUSPENDED') {
        throw forbidden('ACCOUNT_SUSPENDED', 'Your account has been suspended');
      }
      throw unauthorized('SESSION_REVOKED', 'User session was revoked or role changed');
    }

    const roles: string[] = payload.realm_access?.roles ?? [];
    req.auth = {
      userId: payload.sub as string,
      roles,
      email: payload.email as string | undefined,
      token,
    };
  });

  fastify.decorate('requireAdmin', async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.auth || !req.auth.roles.includes('admin')) {
      throw forbidden('INSUFFICIENT_ROLE', 'Admin role required for this action', {
        requiredRoles: ['admin'],
      });
    }
  });
};

export default fp(authPlugin);
