import { Router } from 'express';
import { z } from 'zod';
import { parseOrThrow, requireRole } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { ask } from '../faq.js';
import { newTicket } from '../tickets.js';

const askSchema = z.object({ question: z.string().min(3).max(500) });
const searchSchema = z.object({ q: z.string().min(3).max(500) });
const ticketSchema = z.object({
  question: z.string().min(3).max(500),
  matchedTopics: z.array(z.string().max(200)).max(10).default([]),
  replyTo: z.string().email().max(200).optional(),
});

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

  // Admin triage list: open tickets with the reply-to address, newest first.
  router.get('/support-requests', requireRole('admin'), async (_req, res, next) => {
    try {
      const tickets = await ctx.tickets.listOpen(50);
      tickets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json({ data: tickets });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
