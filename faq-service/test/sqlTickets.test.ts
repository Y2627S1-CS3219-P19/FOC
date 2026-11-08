import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { runMigrations } from '@foc/shared-middleware';
import { SqlTicketStore, newTicket } from '../src/sqlTickets.js';

/**
 * Real-SQL tests for the ticket store, gated on FAQ_TEST_DATABASE_URL (throwaway Postgres,
 * supplier-service pattern). Skipped when unset so default runs stay offline.
 * Start one: docker run -d --rm -e POSTGRES_PASSWORD=test -p 5439:5432 postgres:16-alpine
 */
const TEST_DB_URL = process.env.FAQ_TEST_DATABASE_URL;
describe.skipIf(!TEST_DB_URL)('SqlTicketStore (faq_db)', () => {
  let store: SqlTicketStore;
  let stop: () => void;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, new URL('../migrations', import.meta.url).pathname, {
      info: () => undefined,
    } as never);
    store = new SqlTicketStore(pool, { info: () => undefined } as never);
    stop = () => void pool.end();
  });

  afterAll(() => stop?.());

  it('adds a ticket with an implicit creation history row and lists it newest first', async () => {
    const t = newTicket({ question: 'Where did my credits go?', matchedTopics: ['credits'], replyTo: 'a@u.nus.edu' });
    await store.add(t);
    const later = newTicket({ question: 'Runner never delivered', matchedTopics: [] });
    await store.add(later);

    const list = await store.list(50);
    expect(list[0].ticketId).toBe(later.ticketId);
    const first = list.find((x) => x.ticketId === t.ticketId)!;
    expect(first.status).toBe('open');
    // Data minimisation: no requester identity is stored on the ticket.
    expect(first).not.toHaveProperty('userId');
    expect(first.replyTo).toBe('a@u.nus.edu');
    expect(first.history).toHaveLength(1);
    expect(first.history[0]).toMatchObject({ fromStatus: null, toStatus: 'open', adminId: null });
  });

  it('appends a history row per transition and never rewrites previous ones', async () => {
    const t = newTicket({ question: 'Another ticket', matchedTopics: [] });
    await store.add(t);

    const afterReview = await store.updateStatus(t.ticketId, 'under_review', ['open', 'under_review'], 'admin-1');
    expect(afterReview?.status).toBe('under_review');
    const afterResolved = await store.updateStatus(t.ticketId, 'resolved', ['under_review'], 'admin-2');
    expect(afterResolved?.status).toBe('resolved');
    expect(afterResolved?.resolvedBy).toBe('admin-2');
    expect(afterResolved?.resolvedAt).toBeTruthy();

    const listed = (await store.list(50)).find((x) => x.ticketId === t.ticketId)!;
    expect(listed.history.map((h) => h.toStatus)).toEqual(['open', 'under_review', 'resolved']);
    expect(listed.history[1]).toMatchObject({ fromStatus: 'open', adminId: 'admin-1' });
  });

  it('closes wont_fix from open or under review, attributing the closing admin', async () => {
    const fromOpen = newTicket({ question: 'Not going to fix this one', matchedTopics: [] });
    await store.add(fromOpen);
    const closed = await store.updateStatus(fromOpen.ticketId, 'wont_fix', ['open', 'under_review'], 'admin-1');
    expect(closed?.status).toBe('wont_fix');
    expect(closed?.resolvedBy).toBe('admin-1');
    expect(closed?.resolvedAt).toBeTruthy();

    const fromReview = newTicket({ question: 'Reviewed and declined', matchedTopics: [] });
    await store.add(fromReview);
    await store.updateStatus(fromReview.ticketId, 'under_review', ['open', 'under_review'], 'admin-1');
    const closedLater = await store.updateStatus(fromReview.ticketId, 'wont_fix', ['open', 'under_review'], 'admin-2');
    expect(closedLater?.resolvedBy).toBe('admin-2');

    const listed = (await store.list(50)).filter((x) => x.ticketId === fromReview.ticketId)[0];
    expect(listed.history.map((h) => h.toStatus)).toEqual(['open', 'under_review', 'wont_fix']);
    expect(listed.history[2]).toMatchObject({ fromStatus: 'under_review', adminId: 'admin-2' });
  });

  it('returns null for an unknown ticket and rejects a transition from a terminal state', async () => {
    expect(await store.updateStatus('t-nope', 'resolved', ['open', 'under_review'], 'admin-1')).toBeNull();

    const t = newTicket({ question: 'Done already', matchedTopics: [] });
    await store.add(t);
    await store.updateStatus(t.ticketId, 'resolved', ['open', 'under_review'], 'admin-1');
    await expect(store.updateStatus(t.ticketId, 'under_review', ['open', 'under_review'], 'admin-1')).rejects.toThrow();

    const wontFix = newTicket({ question: 'Closed as wont fix', matchedTopics: [] });
    await store.add(wontFix);
    await store.updateStatus(wontFix.ticketId, 'wont_fix', ['open', 'under_review'], 'admin-1');
    await expect(store.updateStatus(wontFix.ticketId, 'resolved', ['open', 'under_review'], 'admin-1')).rejects.toThrow();
  });

  it('pings a live database', async () => {
    await expect(store.ping()).resolves.toBeUndefined();
  });
});
