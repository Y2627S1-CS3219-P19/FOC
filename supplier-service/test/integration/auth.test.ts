import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { TEST_IMAGES_DIR } from './helpers.js';

describe('Slice 5: Auth & Session Introspection', () => {
  let app: FastifyInstance;
  let privateKey: any;
  let publicKeyJwk: any;

  // Mock introspect behavior handler
  let introspectHandler: (token: string) => Promise<{
    status: number;
    body: any;
  }>;

  beforeAll(async () => {
    // Generate an RSA keypair for testing JWKS
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const jwk = await exportJWK(keyPair.publicKey);
    jwk.kid = 'test-key-id';
    jwk.alg = 'RS256';
    publicKeyJwk = jwk;

    // Create app with test JWKS getter and test introspection fetcher
    app = await buildApp({
      imagesDir: TEST_IMAGES_DIR,
      authConfig: {
        jwksUri: 'http://keycloak.mock/jwks',
        issuer: 'http://localhost:8080/realms/campuserrand',
        getJwksKeys: async () => [publicKeyJwk],
        introspectFn: async (token: string, secret: string) => {
          if (secret !== 'test-internal-secret') {
            return { status: 401, body: { error: { code: 'UNAUTHORIZED' } } };
          }
          return introspectHandler(token);
        },
      },
    });

    // Add a protected test route
    app.get('/v1/test-protected', { preHandler: app.requireAuth }, async (req) => {
      return { success: true, auth: req.auth };
    });

    // Add an admin-only test route
    app.get('/v1/test-admin', { preHandler: [app.requireAuth, app.requireAdmin] }, async () => {
      return { admin: true };
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createToken(opts: {
    sub?: string;
    roles?: string[];
    expiresIn?: string;
  } = {}) {
    const jwt = new SignJWT({
      sub: opts.sub ?? `user-${Math.random()}`,
      realm_access: { roles: opts.roles ?? ['user'] },
      email: 'test@u.nus.edu',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
      .setIssuer('http://localhost:8080/realms/campuserrand')
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '1h');

    return jwt.sign(privateKey);
  }

  it('returns 401 TOKEN_MISSING when Authorization header is not provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: { code: 'TOKEN_MISSING' },
    });
  });

  it('returns 401 TOKEN_INVALID when token has invalid signature or issuer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: 'Bearer invalid.token.string' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: { code: 'TOKEN_INVALID' },
    });
  });

  it('returns 401 SESSION_REVOKED when User Service introspect reports session revoked', async () => {
    introspectHandler = async () => ({
      status: 200,
      body: { active: false, reason: 'SESSION_REVOKED' },
    });

    const token = await createToken({ sub: 'revoked-user' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: { code: 'SESSION_REVOKED' },
    });
  });

  it('returns 403 ACCOUNT_SUSPENDED when User Service introspect reports suspended', async () => {
    introspectHandler = async () => ({
      status: 200,
      body: { active: false, reason: 'ACCOUNT_SUSPENDED' },
    });

    const token = await createToken({ sub: 'suspended-user' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: 'ACCOUNT_SUSPENDED' },
    });
  });

  it('fails closed with 503 AUTH_SERVICE_UNAVAILABLE when User Service introspect is down or errors', async () => {
    introspectHandler = async () => {
      throw new Error('Connection refused to user-service:3001');
    };

    const token = await createToken({ sub: 'error-user' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: 'AUTH_SERVICE_UNAVAILABLE' },
    });
  });

  it('authenticates valid token with active session and decorates request.auth', async () => {
    introspectHandler = async () => ({
      status: 200,
      body: { active: true },
    });

    const token = await createToken({ sub: 'user-456', roles: ['user'] });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      auth: { userId: 'user-456', roles: ['user'] },
    });
  });

  it('returns 403 INSUFFICIENT_ROLE when user lacks admin role for admin route', async () => {
    introspectHandler = async () => ({
      status: 200,
      body: { active: true },
    });

    const token = await createToken({ sub: 'student-1', roles: ['user'] });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/test-admin',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: 'INSUFFICIENT_ROLE' },
    });
  });

  it('allows access to admin route when token carries admin role', async () => {
    introspectHandler = async () => ({
      status: 200,
      body: { active: true },
    });

    const token = await createToken({ sub: 'admin-1', roles: ['admin', 'user'] });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/test-admin',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ admin: true });
  });
});
