import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { RequestHandler } from 'express';
import { createLogger, conflict, unauthorized } from '@foc/shared-middleware';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import type { SupportTicket, TicketStatus, TicketStore } from '../src/sqlTickets.js';
import { newTicket } from '../src/sqlTickets.js';

const config = loadConfig({
  GEMINI_API_KEY: 'test',
  OPENROUTER_API_KEY: 'test',
  FAQ_DATABASE_URL: 'postgres://faq:test@localhost:5438/faq_db',
  LOG_LEVEL: 'silent',
});
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

/** In-memory TicketStore that honours the append-only history contract. */
function memoryTicketStore() {
  const rows = new Map<string, SupportTicket & { internalHistory: SupportTicket['history'] }>();
  const store: TicketStore = {
    add: async (t) => {
      rows.set(t.ticketId, { ...t, internalHistory: [{ fromStatus: null, toStatus: 'open', adminId: null, createdAt: t.createdAt }] });
    },
    list: async (limit) =>
      [...rows.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((r) => ({ ...r, history: [...r.internalHistory] })),
    updateStatus: async (ticketId, toStatus, allowedFrom, adminId) => {
      const row = rows.get(ticketId);
      if (!row) return null;
      if (!allowedFrom.includes(row.status)) {
        throw conflict('INVALID_TRANSITION', `A ticket cannot move from ${row.status} to ${toStatus}.`);
      }
      row.internalHistory.push({ fromStatus: row.status, toStatus, adminId, createdAt: new Date().toISOString() });
      row.status = toStatus;
      return { ...row, history: [...row.internalHistory] };
    },
    ping: async () => {},
  };
  return { store, rows };
}

function buildApp(opts: { pingOk?: boolean; floor?: number } = {}) {
  const ticketRows: Parameters<typeof Object>[0][] = [];
  const tickets = memoryTicketStore();
  const events: { fields: Record<string, unknown>; msg: string }[] = [];
  // Real pino (pino-http needs one) at silent level, with the info method overridden so tests
  // can assert the observability events.
  const logger = createLogger('faq-test', 'silent') as unknown as {
    info: (fields: Record<string, unknown>, msg?: string) => void;
  };
  const baseInfo = logger.info.bind(logger);
  logger.info = (fields: Record<string, unknown>, msg?: string) => {
    events.push({ fields, msg: msg ?? '' });
  };
  void baseInfo;
  const ctx: AppContext = {
    config: opts.floor === undefined ? config : { ...config, similarityFloor: opts.floor },
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
    tickets: tickets.store,
    listEntries: async () => [
      { source: 'faq.md', heading: 'What are credits?', content: 'Credits are the platform payment.' },
    ],
  };
  return { app: createApp(ctx), events };
}

const build = (opts?: { pingOk?: boolean }) => buildApp(opts).app;

describe('FAQ routes', () => {
  it('rejects an unauthenticated ask with the standard 401 envelope', async () => {
    const res = await request(build()).post('/v1/faq/ask').send({ question: 'What are credits?' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an unauthenticated search with the standard 401 envelope', async () => {
    const res = await request(build()).get('/v1/faq/search?q=credits');
    expect(res.status).toBe(401);
  });

  it('returns the knowledge-base entries for the browse list, auth required', async () => {
    const anon = await request(build()).get('/v1/faq/entries');
    expect(anon.status).toBe(401);
    const res = await request(build()).get('/v1/faq/entries').set('Authorization', 'Bearer user-1');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ source: 'faq.md', heading: 'What are credits?' });
    expect(typeof res.body.data[0].content).toBe('string');
  });

  it('answers an authenticated ask with citations', async () => {
    const res = await request(build())
      .post('/v1/faq/ask')
      .set('Authorization', 'Bearer user-1')
      .send({ question: 'What are credits?' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ answer: 'Answer [1]' });
    expect(res.body.citations[0]).toMatchObject({ source: 'faq.md' });
  });

  it('validates the question shape', async () => {
    const res = await request(build()).post('/v1/faq/ask').set('Authorization', 'Bearer user-1').send({ question: 'no' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns retrieved chunks for search', async () => {
    const res = await request(build()).get('/v1/faq/search?q=credits').set('Authorization', 'Bearer user-1');
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ heading: 'h0' });
    expect(typeof res.body.results[0].similarity).toBe('number');
  });

  it('emits a structured ask event for observability', async () => {
    const { app, events } = buildApp();
    // similarity 0.9 in the stub retrieval — an answered ask.
    const res = await request(app).post('/v1/faq/ask').set('Authorization', 'Bearer user-1').send({ question: 'What are credits?' });
    expect(res.status).toBe(200);
    const evt = events.find((e) => e.msg === 'faq ask');
    expect(evt).toBeDefined();
    expect(evt!.fields).toMatchObject({ refused: false, top1Similarity: 0.9 });
    expect(typeof evt!.fields.durationMs).toBe('number');
    expect(Array.isArray(evt!.fields.retrieved)).toBe(true);

    // A refusal flips the flag — the field the FAQ-refusals metric filter greps on.
    const refusing = buildApp({ floor: 0.99 });
    await request(refusing.app).post('/v1/faq/ask').set('Authorization', 'Bearer user-1').send({ question: 'What are credits?' });
    const refusalEvt = refusing.events.find((e) => e.msg === 'faq ask');
    expect(refusalEvt!.fields).toMatchObject({ refused: true, top1Similarity: 0.9 });
  });

  it('reports readiness from the store probe', async () => {
    expect((await request(build({ pingOk: true })).get('/health/ready')).status).toBe(200);
    const down = await request(build({ pingOk: false })).get('/health/ready');
    expect(down.status).toBe(503);
  });

  it('creates a support ticket without storing the requester identity (F28.3)', async () => {
    const res = await request(build())
      .post('/v1/faq/support-requests')
      .set('Authorization', 'Bearer user-42')
      .send({ question: 'My runner never delivered', matchedTopics: ['h0'], replyTo: 'me@u.nus.edu' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('open');
    expect(res.body.ticketId).toMatch(/^t-/);
    // Data minimisation: the requester id is never echoed or persisted.
    expect(res.body).not.toHaveProperty('userId');
  });

  it('rejects a support ticket without a token and validates replyTo', async () => {
    const anon = await request(build())
      .post('/v1/faq/support-requests')
      .send({ question: 'My runner never delivered' });
    expect(anon.status).toBe(401);
    const bad = await request(build())
      .post('/v1/faq/support-requests')
      .set('Authorization', 'Bearer user-42')
      .send({ question: 'My runner never delivered', replyTo: 'not-an-email' });
    expect(bad.status).toBe(422);
  });

  it('lists tickets with their history for admins only', async () => {
    const app = build();
    await request(app)
      .post('/v1/faq/support-requests')
      .set('Authorization', 'Bearer user-42')
      .send({ question: 'My runner never delivered', replyTo: 'me@u.nus.edu' });
    const user = await request(app).get('/v1/faq/support-requests').set('Authorization', 'Bearer user-42');
    expect(user.status).toBe(403);
    const admin = await request(app).get('/v1/faq/support-requests').set('Authorization', 'Bearer admin-1');
    expect(admin.status).toBe(200);
    expect(admin.body.data[0]).toMatchObject({ replyTo: 'me@u.nus.edu', status: 'open' });
    // No requester identity is stored; the reply-to address is the only contact.
    expect(admin.body.data[0]).not.toHaveProperty('userId');
    // The implicit creation row is already in the history.
    expect(admin.body.data[0].history).toHaveLength(1);
    expect(admin.body.data[0].history[0]).toMatchObject({ fromStatus: null, toStatus: 'open' });
  });

  describe('PATCH /v1/faq/support-requests/:id (admin state machine)', () => {
    const raise = (app: ReturnType<typeof build>) =>
      request(app)
        .post('/v1/faq/support-requests')
        .set('Authorization', 'Bearer user-42')
        .send({ question: 'My runner never delivered' })
        .then((r) => r.body.ticketId as string);

    it('walks open → under review → resolved, appending history', async () => {
      const app = build();
      const id = await raise(app);
      const review = await request(app)
        .patch(`/v1/faq/support-requests/${id}`)
        .set('Authorization', 'Bearer admin-1')
        .send({ status: 'under_review' });
      expect(review.status).toBe(200);
      expect(review.body.status).toBe('under_review');

      const resolve = await request(app)
        .patch(`/v1/faq/support-requests/${id}`)
        .set('Authorization', 'Bearer admin-2')
        .send({ status: 'resolved' });
      expect(resolve.status).toBe(200);
      expect(resolve.body.status).toBe('resolved');

      // Append-only: open → under review → resolved is two transition rows on top of creation.
      const list = await request(app).get('/v1/faq/support-requests').set('Authorization', 'Bearer admin-1');
      const ticket = list.body.data.find((t: SupportTicket) => t.ticketId === id);
      expect(ticket.history.map((h: { toStatus: TicketStatus }) => h.toStatus)).toEqual(['open', 'under_review', 'resolved']);
      expect(ticket.history[1]).toMatchObject({ fromStatus: 'open', adminId: 'admin-1' });
      expect(ticket.history[2]).toMatchObject({ fromStatus: 'under_review', adminId: 'admin-2' });
    });

    it('allows the direct open → resolved shortcut', async () => {
      const app = build();
      const id = await raise(app);
      const res = await request(app).patch(`/v1/faq/support-requests/${id}`).set('Authorization', 'Bearer admin-1').send({ status: 'resolved' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('resolved');
    });

    it('rejects an illegal transition with 409 and does not touch the history', async () => {
      const app = build();
      const id = await raise(app);
      const res = await request(app)
        .patch(`/v1/faq/support-requests/${id}`)
        .set('Authorization', 'Bearer admin-1')
        .send({ status: 'under_review' });
      expect(res.status).toBe(200);
      const back = await request(app)
        .patch(`/v1/faq/support-requests/${id}`)
        .set('Authorization', 'Bearer admin-1')
        .send({ status: 'under_review' });
      expect(back.status).toBe(409);
      const list = await request(app).get('/v1/faq/support-requests').set('Authorization', 'Bearer admin-1');
      const ticket = list.body.data.find((t: SupportTicket) => t.ticketId === id);
      expect(ticket.history).toHaveLength(2);
    });

    it('404s an unknown ticket and 422s a bad status', async () => {
      const app = build();
      const missing = await request(app)
        .patch('/v1/faq/support-requests/t-nope')
        .set('Authorization', 'Bearer admin-1')
        .send({ status: 'resolved' });
      expect(missing.status).toBe(404);
      const bad = await request(app)
        .patch('/v1/faq/support-requests/t-x')
        .set('Authorization', 'Bearer admin-1')
        .send({ status: 'deleted' });
      expect(bad.status).toBe(422);
    });

    it('is admin-only (403 for users, 401 anonymous)', async () => {
      const app = build();
      const id = await raise(app);
      expect(
        (await request(app).patch(`/v1/faq/support-requests/${id}`).set('Authorization', 'Bearer user-42').send({ status: 'resolved' }))
          .status,
      ).toBe(403);
      expect((await request(app).patch(`/v1/faq/support-requests/${id}`).send({ status: 'resolved' })).status).toBe(401);
    });
  });
});
