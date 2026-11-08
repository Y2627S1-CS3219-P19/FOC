import { Router } from 'express';
import { z } from 'zod';
import { AppError, parseOrThrow, requireRole, serviceUnavailable } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { ask } from '../faq.js';
import { newTicket, type TicketStatus } from '../sqlTickets.js';

const askSchema = z.object({ question: z.string().min(3).max(500) });
const searchSchema = z.object({ q: z.string().min(3).max(500) });
const ticketSchema = z.object({
  question: z.string().min(3).max(500),
  matchedTopics: z.array(z.string().max(200)).max(10).default([]),
  replyTo: z.string().email().max(200).optional(),
});
const transitionSchema = z.object({ status: z.enum(['under_review', 'resolved', 'wont_fix']) });

/** One user-facing message for any unavailability. The reason stays in logs and /health/ready. */
const FAQ_UNAVAILABLE_MESSAGE = 'The FAQ service is currently unavailable. Please try again later.';
const RETRY_AFTER_SECONDS = '30';

/** 503, not 500: the caller should retry later, it is not a bad request. */
function unavailable(res: { set: (k: string, v: string) => unknown }) {
  res.set('Retry-After', RETRY_AFTER_SECONDS);
  return serviceUnavailable('FAQ_UNAVAILABLE', FAQ_UNAVAILABLE_MESSAGE);
}

/** Serving = the KB has chunks. A service that refuses every question is not available. */
const isServing = (ctx: AppContext) => ctx.kb.ready && ctx.kb.chunks > 0;

// State machine: open → under review → resolved, plus direct open → resolved, plus wont_fix as a
// second terminal state from open or under review.
const ALLOWED_FROM: Record<'under_review' | 'resolved' | 'wont_fix', TicketStatus[]> = {
  under_review: ['open'],
  resolved: ['open', 'under_review'],
  wont_fix: ['open', 'under_review'],
};

export function faqRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(ctx.auth.requireAuth);

  // F28.2: grounded answer with citations, or a refusal that already carries the F28.3 payload.
  router.post('/ask', async (req, res, next) => {
    try {
      const { question } = parseOrThrow(askSchema, req.body);
      if (!isServing(ctx)) return void next(unavailable(res));
      res.json(await ask(ctx, question));
    } catch (err) {
      if (err instanceof AppError) return void next(err);
      // Retrieval or generation failed: a dependency problem, so say "later" rather than 500.
      ctx.logger.error({ err }, 'FAQ ask failed');
      next(unavailable(res));
    }
  });

  // Raw retrieval, used by the UI for "related topics" without spending a generation call.
  router.get('/search', async (req, res, next) => {
    try {
      const { q } = parseOrThrow(searchSchema, req.query);
      if (!isServing(ctx)) return void next(unavailable(res));
      const chunks = await ctx.retrieve(q, ctx.config.topK);
      res.json({
        results: chunks.map((c) => ({
          source: c.doc.metadata.source,
          heading: c.doc.metadata.heading,
          content: c.doc.pageContent,
          similarity: Number(c.similarity.toFixed(4)),
        })),
      });
    } catch (err) {
      if (err instanceof AppError) return void next(err);
      ctx.logger.error({ err }, 'FAQ search failed');
      next(unavailable(res));
    }
  });

  // The FAQ page's browse list IS the knowledge base, so it can never drift from what the bot cites.
  router.get('/entries', async (_req, res, next) => {
    try {
      res.json({ data: await ctx.listEntries() });
    } catch (err) {
      next(err);
    }
  });

  // F28.3: login-gated support ticket. The requester is authenticated but not recorded; the
  // reply-to address they give is the only contact stored.
  router.post('/support-requests', async (req, res, next) => {
    try {
      const input = parseOrThrow(ticketSchema, req.body);
      const ticket = newTicket({
        question: input.question,
        matchedTopics: input.matchedTopics,
        replyTo: input.replyTo,
      });
      await ctx.tickets.add(ticket);
      ctx.logger.info({ ticketId: ticket.ticketId }, 'Support request created');
      res.status(201).json({ ticketId: ticket.ticketId, status: ticket.status });
    } catch (err) {
      if (err instanceof AppError) return void next(err);
      // Ask keeps working when only the ticket database is broken, so this is a 500, not a 503.
      ctx.logger.error({ err }, 'Could not store the support request');
      next(new AppError(500, 'SUPPORT_UNAVAILABLE', 'Support requests are temporarily unavailable. Please try again later.'));
    }
  });

  // Admin triage list: all statuses with their append-only transition history, newest first.
  router.get('/support-requests', requireRole('admin'), async (_req, res, next) => {
    try {
      res.json({ data: await ctx.tickets.list(100) });
    } catch (err) {
      next(err);
    }
  });

  // Admin-only state machine. The store applies UPDATE + history append in one transaction.
  router.patch('/support-requests/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const { status } = parseOrThrow(transitionSchema, req.body);
      const id = String(req.params.id);
      const ticket = await ctx.tickets.updateStatus(id, status, ALLOWED_FROM[status], req.auth!.userId);
      if (!ticket) return void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such support request.' } });
      res.json({ ticketId: ticket.ticketId, status: ticket.status, history: ticket.history });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
