import { Router } from 'express';
import { z } from 'zod';
import { parseOrThrow, requireRole } from '@foc/shared-middleware';
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
const transitionSchema = z.object({ status: z.enum(['under_review', 'resolved']) });

// State machine: open → under review → resolved, plus direct open → resolved.
const ALLOWED_FROM: Record<'under_review' | 'resolved', TicketStatus[]> = {
  under_review: ['open'],
  resolved: ['open', 'under_review'],
};

export function faqRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(ctx.auth.requireAuth);

  // F28.2: grounded answer with citations, or a refusal that already carries the F28.3 payload.
  router.post('/ask', async (req, res, next) => {
    try {
      const { question } = parseOrThrow(askSchema, req.body);
      const response = await ask(ctx, question, req.auth!.userId);
      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  // Raw retrieval, used by the UI for "related topics" without spending a generation call.
  router.get('/search', async (req, res, next) => {
    try {
      const { q } = parseOrThrow(searchSchema, req.query);
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
      next(err);
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

  // F28.3: login-gated support ticket. The userId comes from the verified token, never from the body.
  router.post('/support-requests', async (req, res, next) => {
    try {
      const input = parseOrThrow(ticketSchema, req.body);
      const ticket = newTicket({
        userId: req.auth!.userId,
        question: input.question,
        matchedTopics: input.matchedTopics,
        replyTo: input.replyTo,
      });
      await ctx.tickets.add(ticket);
      ctx.logger.info({ ticketId: ticket.ticketId, userId: ticket.userId }, 'Support request created');
      res.status(201).json({ ticketId: ticket.ticketId, status: ticket.status });
    } catch (err) {
      next(err);
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
