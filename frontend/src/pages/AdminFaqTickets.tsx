import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api';
import { ErrorBox } from '../components';
import { dayAndTime, shortId } from '../errands';
import type { FaqTicket, TicketStatus } from '../faq';

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'open',
  under_review: 'under review',
  resolved: 'resolved',
  wont_fix: "won't fix",
};

/** What the state machine allows from each status; a resolved or wont_fix ticket is terminal. */
const NEXT_STATUS: Partial<Record<TicketStatus, { status: TicketStatus; label: string }[]>> = {
  open: [
    { status: 'under_review', label: 'Start review' },
    { status: 'resolved', label: 'Resolve' },
    { status: 'wont_fix', label: "Won't fix" },
  ],
  under_review: [
    { status: 'resolved', label: 'Resolve' },
    { status: 'wont_fix', label: "Won't fix" },
  ],
};

/** Admin triage for FAQ support requests (F28.3): filter by status, transition, inspect history. */
export function AdminFaqTicketsPage() {
  const api = useApi();
  const [tickets, setTickets] = useState<FaqTicket[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<TicketStatus | ''>('');

  const load = useCallback(() => {
    api<{ data: FaqTicket[] }>('GET', '/v1/faq/support-requests').then(
      (r) => setTickets(r.data),
      setError,
    );
  }, [api]);

  useEffect(load, [load]);

  // The ticket's status change is a command the admin issues; the server enforces the
  // state machine and appends to the history. Refresh after every outcome.
  const transition = async (ticketId: string, status: TicketStatus) => {
    setError(null);
    try {
      await api('PATCH', `/v1/faq/support-requests/${ticketId}`, { status });
      load();
    } catch (err) {
      setError(err);
    }
  };

  const visible = tickets?.filter((t) => !filter || t.status === filter) ?? [];

  return (
    <div className="stack">
      <h1>Admin: FAQ tickets</h1>
      <p className="small muted">
        Open support requests raised from the FAQ page or the help chat. Transitions are
        admin-only and recorded in an append-only history; reach the user at their reply-to
        address (falls back to their registered email on the Admin: users page).
      </p>
      <div className="filters card">
        <select value={filter} onChange={(e) => setFilter(e.target.value as TicketStatus | '')} aria-label="Status">
          <option value="">Any status</option>
          <option value="open">open</option>
          <option value="under_review">under review</option>
          <option value="resolved">resolved</option>
          <option value="wont_fix">won't fix</option>
        </select>
      </div>
      <ErrorBox error={error} />
      {!tickets && !error && <p className="muted">Loading…</p>}
      {tickets && visible.length === 0 && <p className="muted">No support requests with this status.</p>}
      {visible.length > 0 && (
        <table className="responsive">
          <thead>
            <tr>
              <th>When</th>
              <th>Ticket</th>
              <th>Question</th>
              <th>Closest topics</th>
              <th>Reply-to</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.ticketId}>
                <td data-label="When">{dayAndTime(t.createdAt)}</td>
                <td data-label="Ticket" title={t.ticketId}>
                  {shortId(t.ticketId)} <span className="muted">({STATUS_LABEL[t.status]})</span>
                  {t.resolvedAt && (
                    <div className="small muted">closed by {shortId(t.resolvedBy ?? '')}</div>
                  )}
                </td>
                <td data-label="Question">{t.question}</td>
                <td data-label="Closest topics">{t.matchedTopics.length ? t.matchedTopics.join(' · ') : '—'}</td>
                <td data-label="Reply-to">{t.replyTo ?? '—'}</td>
                <td data-label="Actions">
                  <div className="stack-tight">
                    {(NEXT_STATUS[t.status] ?? []).map((n) => (
                      <button key={n.status} className="ghost" onClick={() => transition(t.ticketId, n.status)}>
                        {n.label}
                      </button>
                    ))}
                    {(t.status === 'resolved' || t.status === 'wont_fix') && <span className="small muted">done</span>}
                    <details>
                      <summary className="small">history ({t.history.length})</summary>
                      {t.history.map((h, i) => (
                        <div key={i} className="small muted">
                          {h.fromStatus ? `${h.fromStatus} → ${h.toStatus}` : `created (${h.toStatus})`}
                          {h.adminId ? ` by ${shortId(h.adminId)}` : ''} · {dayAndTime(h.createdAt)}
                        </div>
                      ))}
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
