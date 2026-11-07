import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { RequestHandler } from 'express';
import { createLogger, unauthorized } from '@foc/shared-middleware';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';

const config = loadConfig({ GEMINI_API_KEY: 'test', OPENROUTER_API_KEY: 'test', LOG_LEVEL: 'silent' });
const logger = createLogger('faq-test', 'silent');

/** Stub authenticator: any Bearer token accepted; token starting with 'admin' gets the admin role. */
const stubAuth = {
  verify: async (token: string) => ({
    userId: token,
    emailVerified: true,
    roles: token.startsWith('admin') ? ['admin'] : ['user'],
    token,
  }),
  requireAuth: ((req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(unauthorized());
    const token = header.slice(7);
    req.auth = { userId: token, emailVerified: true, roles: token.startsWith('admin') ? ['admin'] : ['user'], token };
    next();
  }) as RequestHandler,
};

function buildApp(opts: { pingOk?: boolean } = {}) {
  const ticketRows: Parameters<typeof Object>[0][] = [];
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
    tickets: {
      add: async (t) => {
        ticketRows.push(t);
      },
      listOpen: async () => ticketRows as never,
      ping: async () => {},
    },
    listEntries: async () => [
      { source: 'faq.md', heading: 'What are credits?', content: 'Credits are the platform payment.' },
    ],
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

  it('returns the knowledge-base entries for the browse list, auth required', async () => {
    const anon = await request(buildApp()).get('/v1/faq/entries');
    expect(anon.status).toBe(401);
    const res = await request(buildApp()).get('/v1/faq/entries').set('Authorization', 'Bearer user-1');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ source: 'faq.md', heading: 'What are credits?' });
    expect(typeof res.body.data[0].content).toBe('string');
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

  it('creates a support ticket stamped with the token-verified userId (F28.3)', async () => {
    const res = await request(buildApp())
      .post('/v1/faq/support-requests')
      .set('Authorization', 'Bearer user-42')
      .send({ question: 'My runner never delivered', matchedTopics: ['h0'], replyTo: 'me@u.nus.edu' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('open');
    expect(res.body.ticketId).toMatch(/^t-/);
  });

  it('rejects a support ticket without a token and validates replyTo', async () => {
    const anon = await request(buildApp())
      .post('/v1/faq/support-requests')
      .send({ question: 'My runner never delivered' });
    expect(anon.status).toBe(401);
    const bad = await request(buildApp())
      .post('/v1/faq/support-requests')
      .set('Authorization', 'Bearer user-42')
      .send({ question: 'My runner never delivered', replyTo: 'not-an-email' });
    expect(bad.status).toBe(422);
  });

  it('lists open tickets for admins only', async () => {
    const app = buildApp();
    await request(app)
      .post('/v1/faq/support-requests')
      .set('Authorization', 'Bearer user-42')
      .send({ question: 'My runner never delivered', replyTo: 'me@u.nus.edu' });
    const user = await request(app).get('/v1/faq/support-requests').set('Authorization', 'Bearer user-42');
    expect(user.status).toBe(403);
    const admin = await request(app).get('/v1/faq/support-requests').set('Authorization', 'Bearer admin-1');
    expect(admin.status).toBe(200);
    expect(admin.body.data[0]).toMatchObject({ userId: 'user-42', replyTo: 'me@u.nus.edu', status: 'open' });
  });
});
