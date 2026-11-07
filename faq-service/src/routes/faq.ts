import { Router } from 'express';
import { z } from 'zod';
import { parseOrThrow } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { ask } from '../faq.js';

const askSchema = z.object({ question: z.string().min(3).max(500) });
const searchSchema = z.object({ q: z.string().min(3).max(500) });

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

  return router;
}
