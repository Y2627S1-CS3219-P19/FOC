import { Router } from 'express';
import type { AppContext } from '../context.js';

/** The probe must finish before the 5s healthcheck timeout, so a hung store fails fast. */
const PROBE_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err as Error);
      },
    );
  });
}

export function healthRouter(ctx: AppContext): Router {
  const router = Router();

  // Liveness is static: a restart fixes a wedged process, never a missing dependency.
  router.get('/health/live', (_req, res) => {
    res.json({ status: 'ok', service: 'faq-service' });
  });

  /**
   * Readiness answers two questions at once: "should the orchestrator replace this task?" (status)
   * and "can the feature serve?" (faq). They differ: a missing dependency is not fixed by a
   * restart, but an empty knowledge base means every ask would refuse, so it must not report
   * healthy either.
   *
   * The live chunk count is used rather than the boot-time flag, so a store that comes back empty
   * (lost volume) is caught without a restart.
   */
  router.get('/health/ready', async (_req, res) => {
    const base = { store: ctx.config.chromaUrl };

    let chunks: number;
    try {
      chunks = await withTimeout(ctx.countStore(), PROBE_TIMEOUT_MS);
    } catch (err) {
      ctx.logger.warn({ err }, 'Vector store not reachable');
      return void res.status(503).json({ status: 'unavailable', faq: 'unavailable', reason: 'STORE_DOWN', ...base });
    }

    if (chunks === 0) {
      ctx.logger.warn({ chunks }, 'Knowledge base is empty');
      return void res
        .status(503)
        .json({ status: 'unavailable', faq: 'unavailable', reason: ctx.kb.reason ?? 'KB_EMPTY', chunks, ...base });
    }

    res.json({ status: 'ok', faq: 'available', chunks, ...base });
  });

  return router;
}
