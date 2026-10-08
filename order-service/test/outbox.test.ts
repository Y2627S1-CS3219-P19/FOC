import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { MAX_ATTEMPTS, afterFailure } from '../src/events/creditConsumer.js';
import { logOutboxStatus } from '../src/jobs/outboxMonitor.js';
import { outboxStats } from '../src/repositories/outboxRepository.js';
import { createTestContext, resetDb } from './helpers.js';

let ctx: AppContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.pool.end();
});
beforeEach(async () => {
  await resetDb(ctx);
});
afterEach(() => {
  ctx.broker = undefined;
});

/** An outbox row created `ageSeconds` ago, published `lagSeconds` after it was created (or never). */
async function outboxRow(ageSeconds: number, lagSeconds: number | null) {
  await ctx.pool.query(
    `INSERT INTO outbox_events (id, exchange, routing_key, event_type, envelope, created_at, published_at)
     VALUES ($1, 'order.events', 'order.created', 'OrderCreated', '{}',
             now() - make_interval(secs => $2),
             CASE WHEN $3::float8 IS NULL THEN NULL ELSE now() - make_interval(secs => $2) + make_interval(secs => $3) END)`,
    [randomUUID(), ageSeconds, lagSeconds],
  );
}

describe('outboxStats', () => {
  it('counts the backlog and measures publish lag over the last 5 minutes', async () => {
    await outboxRow(90, null);
    await outboxRow(5, null);
    await outboxRow(30, 2);
    await outboxRow(40, 4);
    await outboxRow(900, 1); // published 15 minutes ago: not in the 5-minute window

    const stats = await outboxStats(ctx.pool);
    expect(stats.backlog).toBe(2);
    expect(stats.oldestUnpublishedSeconds).toBeGreaterThanOrEqual(90);
    expect(stats.oldestUnpublishedSeconds).toBeLessThan(95);
    expect(stats.publishedLast5m).toBe(2);
    expect(stats.avgPublishLagSeconds).toBe(3);
    expect(stats.maxPublishLagSeconds).toBe(4);
  });

  it('is all zeros on an empty outbox', async () => {
    expect(await outboxStats(ctx.pool)).toEqual({
      backlog: 0,
      oldestUnpublishedSeconds: 0,
      publishedLast5m: 0,
      avgPublishLagSeconds: 0,
      maxPublishLagSeconds: 0,
    });
  });
});

describe('outbox monitor log line', () => {
  const fakeLogger = () => ({ info: vi.fn(), warn: vi.fn() });

  it('warns when an event has waited more than 60s', async () => {
    await outboxRow(120, null);
    const logger = fakeLogger();
    await logOutboxStatus(ctx.pool, logger as unknown as Logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ outbox: expect.objectContaining({ backlog: 1 }) }),
      expect.stringContaining('Outbox publish lag'),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('logs at info level when the outbox is healthy', async () => {
    await outboxRow(3, null);
    const logger = fakeLogger();
    await logOutboxStatus(ctx.pool, logger as unknown as Logger);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ outbox: expect.anything() }), 'Outbox status');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('dead-letter queue', () => {
  it(`retries ${MAX_ATTEMPTS - 1} times, then dead-letters on attempt ${MAX_ATTEMPTS}`, () => {
    const steps = [0, 1, 2, 3, 4].map((previous) => afterFailure(previous));
    expect(steps).toEqual([
      { attempt: 1, deadLetter: false },
      { attempt: 2, deadLetter: false },
      { attempt: 3, deadLetter: false },
      { attempt: 4, deadLetter: false },
      { attempt: 5, deadLetter: true },
    ]);
  });

  it('the monitor warns when the dead-letter queue is not empty', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    await logOutboxStatus(ctx.pool, logger as unknown as Logger, { isConnected: () => true, dlqDepth: async () => 2 });
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ dlqDepth: 2 }), 'Outbox status');
    expect(logger.warn).toHaveBeenCalledWith({ dlqDepth: 2 }, expect.stringContaining('Dead-letter queue'));
  });
});

describe('/health/ready and /metrics', () => {
  it.each([
    [undefined, 'DISABLED', 'UP'],
    [{ isConnected: () => true, dlqDepth: async () => 0 }, 'UP', 'UP'],
    [{ isConnected: () => false, dlqDepth: async () => null }, 'DOWN', 'DEGRADED'],
  ])('broker %#: reports %s, status %s, still 200', async (broker, brokerState, status) => {
    ctx.broker = broker;
    const res = await request(createApp(ctx)).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status, checks: { db: true, broker: brokerState } });
  });

  it('/metrics shows the broker state, outbox numbers and dead-letter queue depth', async () => {
    await outboxRow(10, null);
    ctx.broker = { isConnected: () => true, dlqDepth: async () => 3 };
    const res = await request(createApp(ctx)).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.body.broker).toBe('UP');
    expect(res.body.outbox).toMatchObject({ backlog: 1, publishedLast5m: 0 });
    expect(res.body.deadLetterQueue).toEqual({ depth: 3 });
  });

  it('/metrics shows a null DLQ depth without RabbitMQ', async () => {
    const res = await request(createApp(ctx)).get('/metrics');
    expect(res.body.deadLetterQueue).toEqual({ depth: null });
  });
});
