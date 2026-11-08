import { randomUUID } from 'node:crypto';
import { conflict } from '@foc/shared-middleware';
import type { Logger } from 'pino';
import type { Pool } from './db.js';

export type TicketStatus = 'open' | 'under_review' | 'resolved' | 'wont_fix';

export interface TicketStatusHistoryEntry {
  fromStatus: string | null;
  toStatus: string;
  adminId: string | null;
  createdAt: string;
}

export interface SupportTicket {
  ticketId: string;
  question: string;
  matchedTopics: string[];
  replyTo?: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  /** Append-only transition log; the tickets.status column is a cache of its latest row. */
  history: TicketStatusHistoryEntry[];
}

export interface TicketStore {
  add(ticket: SupportTicket): Promise<void>;
  /** All statuses, newest first. */
  list(limit: number): Promise<SupportTicket[]>;
  /**
   * Single transaction: UPDATE tickets + INSERT into the append-only history. `allowedFrom`
   * carries the legal source statuses (the state machine lives in the route). Returns the
   * updated ticket, or null when the ticket does not exist; throws conflict() on an illegal
   * transition.
   */
  updateStatus(ticketId: string, toStatus: TicketStatus, allowedFrom: string[], adminId: string): Promise<SupportTicket | null>;
  ping(): Promise<void>;
}

interface TicketRow {
  ticket_id: string;
  question: string;
  matched_topics: string[];
  reply_to: string | null;
  status: TicketStatus;
  created_at: Date;
  updated_at: Date;
  resolved_by: string | null;
  resolved_at: Date | null;
  history: { fromStatus: string | null; toStatus: string; adminId: string | null; createdAt: Date }[] | null;
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : undefined);

function toTicket(row: TicketRow): SupportTicket {
  return {
    ticketId: row.ticket_id,
    question: row.question,
    matchedTopics: row.matched_topics ?? [],
    replyTo: row.reply_to ?? undefined,
    status: row.status,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    resolvedBy: row.resolved_by ?? undefined,
    resolvedAt: iso(row.resolved_at),
    history: (row.history ?? [])
      .sort((a, b) => new Date(a.createdAt).toISOString().localeCompare(new Date(b.createdAt).toISOString()))
      .map((h) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus, adminId: h.adminId, createdAt: iso(h.createdAt)! })),
  };
}

const LIST_SQL = `
  SELECT t.ticket_id, t.question, t.matched_topics, t.reply_to, t.status,
         t.created_at, t.updated_at, t.resolved_by, t.resolved_at,
         h.history
  FROM tickets t
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
             'fromStatus', h.from_status, 'toStatus', h.to_status,
             'adminId', h.admin_id, 'createdAt', h.created_at)
           ORDER BY h.id) AS history
    FROM ticket_status_history h WHERE h.ticket_id = t.ticket_id
  ) h ON true
`;

export class SqlTicketStore implements TicketStore {
  constructor(
    private pool: Pool,
    private logger: Logger,
  ) {}

  async add(ticket: SupportTicket): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tickets (ticket_id, question, matched_topics, reply_to, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [ticket.ticketId, ticket.question, JSON.stringify(ticket.matchedTopics), ticket.replyTo ?? null, 'open'],
      );
      // Implicit creation row: the history starts at birth, not at the first transition.
      await client.query(`INSERT INTO ticket_status_history (ticket_id, from_status, to_status) VALUES ($1, NULL, 'open')`, [
        ticket.ticketId,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async list(limit: number): Promise<SupportTicket[]> {
    const { rows } = await this.pool.query<TicketRow>(`${LIST_SQL} ORDER BY t.created_at DESC LIMIT $1`, [limit]);
    return rows.map(toTicket);
  }

  async updateStatus(
    ticketId: string,
    toStatus: TicketStatus,
    allowedFrom: string[],
    adminId: string,
  ): Promise<SupportTicket | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: TicketStatus }>('SELECT status FROM tickets WHERE ticket_id = $1 FOR UPDATE', [
        ticketId,
      ]);
      if (!current.rows.length) {
        await client.query('ROLLBACK');
        return null;
      }
      const fromStatus = current.rows[0].status;
      if (!allowedFrom.includes(fromStatus)) {
        await client.query('ROLLBACK');
        throw conflict('INVALID_TRANSITION', `A ticket cannot move from ${fromStatus} to ${toStatus}.`);
      }
      const closing = toStatus === 'resolved' || toStatus === 'wont_fix';
      await client.query(
        `UPDATE tickets SET status = $2, updated_at = now()
           ${closing ? ', resolved_by = $3, resolved_at = now()' : ''}
         WHERE ticket_id = $1`,
        closing ? [ticketId, toStatus, adminId] : [ticketId, toStatus],
      );
      await client.query('INSERT INTO ticket_status_history (ticket_id, from_status, to_status, admin_id) VALUES ($1, $2, $3, $4)', [
        ticketId,
        fromStatus,
        toStatus,
        adminId,
      ]);
      await client.query('COMMIT');
      this.logger.info({ ticketId, fromStatus, toStatus, adminId }, 'Ticket status changed');
      const { rows } = await this.pool.query<TicketRow>(`${LIST_SQL} WHERE t.ticket_id = $1`, [ticketId]);
      return rows.length ? toTicket(rows[0]) : null;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

export function newTicket(input: { question: string; matchedTopics: string[]; replyTo?: string }): SupportTicket {
  const now = new Date().toISOString();
  return {
    ticketId: `t-${randomUUID().slice(0, 8)}`,
    question: input.question,
    matchedTopics: input.matchedTopics,
    replyTo: input.replyTo,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}
