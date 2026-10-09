import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { PoolClient } from 'pg';
import type { Logger } from 'pino';
import { withTransaction } from '../db.js';
import { TRANSITIONS, type Action } from '../domain/transitions.js';
import { applyTransition } from '../services/transitionService.js';

const BATCH = 100;

interface SweepOptions {
  /** Picks the due order ids. All time checks use database now(). */
  selectSql: string;
  params: unknown[];
  action: Action;
  reason: string;
  /** Extra change in the same transaction, only when the transition happened. */
  after?: (client: PoolClient, orderId: string) => Promise<void>;
}

/**
 * Applies a system transition to each due order, one transaction per order, through the same conditional
 * UPDATE that users go through. If a user changed the order first, the UPDATE changes 0 rows and it is skipped.
 */
async function sweep(pool: pg.Pool, logger: Logger, o: SweepOptions): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(o.selectSql, o.params);
  const t = TRANSITIONS[o.action];
  let changed = 0;
  for (const { id } of rows) {
    const correlationId = randomUUID();
    const order = await withTransaction(pool, async (client) => {
      const row = await applyTransition(client, {
        action: o.action,
        actor: 'system',
        orderId: id,
        actorId: null,
        correlationId,
        reason: o.reason,
      });
      if (row && o.after) await o.after(client, id);
      return row;
    });
    if (order) {
      changed++;
      logger.info(
        { orderId: id, from: t.from, to: t.to, reason: o.reason, version: order.version, correlationId },
        'Order transition',
      );
    }
  }
  return changed;
}

/** OPEN orders past their expiry -> EXPIRED (Credit gives the credits back on order.expired). */
export function expireOverdue(pool: pg.Pool, logger: Logger): Promise<number> {
  return sweep(pool, logger, {
    selectSql: `SELECT id FROM orders WHERE status = 'OPEN' AND expires_at <= now() ORDER BY expires_at LIMIT ${BATCH}`,
    params: [],
    action: 'expire',
    reason: 'EXPIRED',
  });
}

/** DELIVERED orders the requester has not confirmed in time -> COMPLETED (Credit pays the runner). */
export function autoConfirmDelivered(pool: pg.Pool, afterHours: number, logger: Logger): Promise<number> {
  return sweep(pool, logger, {
    selectSql: `SELECT id FROM orders WHERE status = 'DELIVERED' AND delivered_at <= now() - make_interval(secs => $1)
                ORDER BY delivered_at LIMIT ${BATCH}`,
    params: [afterHours * 3600],
    action: 'confirm',
    reason: 'AUTO_CONFIRMED',
  });
}

/** PENDING orders that Credit Service never answered -> REJECTED with CREDIT_TIMEOUT. */
export function rejectStalePending(pool: pg.Pool, timeoutSeconds: number, logger: Logger): Promise<number> {
  return sweep(pool, logger, {
    selectSql: `SELECT id FROM orders WHERE status = 'PENDING' AND created_at < now() - make_interval(secs => $1)
                ORDER BY created_at LIMIT ${BATCH}`,
    params: [timeoutSeconds],
    action: 'reject',
    reason: 'CREDIT_TIMEOUT',
    after: async (client, id) => {
      await client.query(`UPDATE orders SET rejection_reason = 'CREDIT_TIMEOUT' WHERE id = $1`, [id]);
    },
  });
}

export interface Job {
  stop(): void;
}

/** Runs `task` every intervalMs. Skips a tick if the previous run has not finished, so runs never overlap. */
export function runEvery(name: string, intervalMs: number, task: () => Promise<unknown>, logger: Logger): Job {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    task()
      .catch((err) => logger.error({ job: name, err: (err as Error).message }, 'Job failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}

export interface SweeperOptions {
  pool: pg.Pool;
  logger: Logger;
  intervalMs: number;
  autoConfirmAfterHours: number;
  pendingTimeoutSeconds: number;
}

/** One timer for all three sweeps, run one after another. */
export function startSweepers(o: SweeperOptions): Job {
  return runEvery(
    'sweepers',
    o.intervalMs,
    async () => {
      await expireOverdue(o.pool, o.logger);
      await autoConfirmDelivered(o.pool, o.autoConfirmAfterHours, o.logger);
      await rejectStalePending(o.pool, o.pendingTimeoutSeconds, o.logger);
    },
    o.logger,
  );
}
