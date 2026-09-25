import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';
import { AppError, forbidden, unauthorized } from './errors.js';

export type Role = 'user' | 'admin';

/** What every service knows about the caller after the token is verified. */
export interface AuthContext {
  userId: string; // Keycloak `sub` = users.id in the User Service
  username?: string;
  email?: string;
  emailVerified: boolean;
  roles: string[]; // from realm_access.roles
  token: string;
  expiresAt?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      correlationId?: string;
      accountStatus?: 'active' | 'suspended';
    }
  }
}

export interface AuthOptions {
  /** Expected `iss`, e.g. http://localhost:8080/realms/campuserrand (the public Keycloak URL). */
  issuer: string;
  /** Where to fetch signing keys, e.g. http://keycloak:8080/realms/campuserrand/protocol/openid-connect/certs */
  jwksUrl: string;
  /** Keycloak clients whose user tokens are accepted (`azp` claim). */
  allowedClients: string[];
}

interface KeycloakClaims extends JWTPayload {
  typ?: string;
  azp?: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  realm_access?: { roles?: string[] };
}

export interface Authenticator {
  /** Verifies signature, issuer, expiry, token type and client. Throws a 401 AppError when invalid. */
  verify(token: string): Promise<AuthContext>;
  /** Express middleware: requires `Authorization: Bearer <access token>`. */
  requireAuth: RequestHandler;
}

export function createAuthenticator(options: AuthOptions): Authenticator {
  const jwks = createRemoteJWKSet(new URL(options.jwksUrl), { cooldownDuration: 30_000 });

  async function verify(token: string): Promise<AuthContext> {
    let payload: KeycloakClaims;
    try {
      ({ payload } = await jwtVerify<KeycloakClaims>(token, jwks, { issuer: options.issuer, clockTolerance: 5 }));
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw unauthorized('TOKEN_EXPIRED', 'Your session token has expired. Please log in again.');
      throw unauthorized('TOKEN_INVALID', 'Your session token is not valid. Please log in again.');
    }
    if (payload.typ && payload.typ !== 'Bearer') throw unauthorized('TOKEN_INVALID', 'Only access tokens are accepted.');
    if (!payload.azp || !options.allowedClients.includes(payload.azp)) {
      throw unauthorized('TOKEN_INVALID', 'This token was not issued for the FoC app.');
    }
    if (!payload.sub) throw unauthorized('TOKEN_INVALID', 'Token has no subject.');
    return {
      userId: payload.sub,
      username: payload.preferred_username,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      roles: payload.realm_access?.roles ?? [],
      token,
      expiresAt: payload.exp,
    };
  }

  const requireAuth: RequestHandler = async (req, _res, next) => {
    try {
      const header = req.header('authorization');
      if (!header) throw unauthorized('TOKEN_MISSING', 'Please log in to continue.');
      const [scheme, token] = header.split(' ');
      if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized('TOKEN_MISSING', 'Expected a Bearer token.');
      req.auth = await verify(token);
      next();
    } catch (err) {
      next(err);
    }
  };

  return { verify, requireAuth };
}

export function hasRole(req: Request, role: Role): boolean {
  return req.auth?.roles.includes(role) ?? false;
}

/** RBAC check on the server for every protected route (F6.1, F6.2). 401 if not logged in, 403 if wrong role. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.some((role) => req.auth!.roles.includes(role))) {
      return next(
        forbidden('INSUFFICIENT_ROLE', `This action requires the ${roles.join(' or ')} role.`, { requiredRoles: roles }),
      );
    }
    next();
  };
}

/** Only the owner of a resource or an admin may continue. `getOwnerId` reads the owner from the request. */
export function requireOwnerOrAdmin(getOwnerId: (req: Request) => string | undefined): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (hasRole(req, 'admin') || getOwnerId(req) === req.auth.userId) return next();
    next(forbidden('NOT_OWNER', 'You can only access your own data.'));
  };
}

export { AppError };
