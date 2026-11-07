import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { RequestHandler } from 'express';
import { createLogger, unauthorized } from '@foc/shared-middleware';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';

const config = loadConfig({ GEMINI_API_KEY: 'test', OPENROUTER_API_KEY: 'test', LOG_LEVEL: 'silent' });
const logger = createLogger('faq-test', 'silent');

/** Stub authenticator: any Bearer token is accepted; missing header -> 401 envelope. */
const stubAuth = {
  verify: async (token: string) => ({ userId: token, emailVerified: true, roles: ['user'], token }),
  requireAuth: ((req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(unauthorized());
    req.auth = { userId: header.slice(7), emailVerified: true, roles: ['user'], token: header.slice(7) };
    next();
  }) as RequestHandler,
};

function buildApp(opts: { pingOk?: boolean } = {}) {
  const ctx: AppContext = {
    config,
    logger,
    auth: stubAuth,
    retrieve: async (q, k) =>
      Array.from({ length: Math.min(k, 2) }, (_, i) => ({
        doc: { pageContent: `chunk ${i}`, metadata: { source: 'faq.md', heading: `h${i}` } },
        similarity: 0.9 - i * 0.1,
      })),
    generate: async () => 'Answer [1]',
    pingStore: async () => {
      if (!opts.pingOk) throw new Error('chroma down');
    },
  };
  return createApp(ctx);
}

describe('FAQ routes', () => {
  it('rejects an unauthenticated ask with the standard 401 envelope', async () => {
    const res = await request(buildApp()).post('/v1/faq/ask').send({ question: 'What are credits?' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an unauthenticated search with the standard 401 envelope', async () => {
    const res = await request(buildApp()).get('/v1/faq/search?q=credits');
    expect(res.status).toBe(401);
  });

  it('answers an authenticated ask with citations', async () => {
    const res = await request(buildApp())
      .post('/v1/faq/ask')
      .set('Authorization', 'Bearer user-1')
      .send({ question: 'What are credits?' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ answer: 'Answer [1]' });
    expect(res.body.citations[0]).toMatchObject({ source: 'faq.md' });
  });

  it('validates the question shape', async () => {
    const res = await request(buildApp()).post('/v1/faq/ask').set('Authorization', 'Bearer user-1').send({ question: 'no' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns retrieved chunks for search', async () => {
    const res = await request(buildApp()).get('/v1/faq/search?q=credits').set('Authorization', 'Bearer user-1');
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ heading: 'h0' });
    expect(typeof res.body.results[0].similarity).toBe('number');
  });

  it('reports readiness from the store probe', async () => {
    expect((await request(buildApp({ pingOk: true })).get('/health/ready')).status).toBe(200);
    const down = await request(buildApp({ pingOk: false })).get('/health/ready');
    expect(down.status).toBe(503);
  });
});
