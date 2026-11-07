import { useEffect, useState } from 'react';
import { useApi } from '../api';
import { ErrorBox } from '../components';
import { dayAndTime, shortId } from '../errands';
import type { FaqTicket } from '../faq';

/** Admin triage for FAQ support requests: open tickets, newest first (F28.3). */
export function AdminFaqTicketsPage() {
  const api = useApi();
  const [tickets, setTickets] = useState<FaqTicket[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ data: FaqTicket[] }>('GET', '/v1/faq/support-requests').then(
      (r) => setTickets(r.data),
      setError,
    );
  }, [api]);

  return (
    <div className="stack">
      <h1>Admin: FAQ tickets</h1>
      <p className="small muted">
        Open support requests raised from the FAQ page or the help chat. Reach the user at their
        reply-to address (falls back to their registered email on the Admin: users page).
      </p>
      <ErrorBox error={error} />
      {!tickets && !error && <p className="muted">Loading…</p>}
      {tickets && tickets.length === 0 && <p className="muted">No open support requests.</p>}
      {tickets && tickets.length > 0 && (
        <table className="responsive">
          <thead>
            <tr>
              <th>When</th>
              <th>Ticket</th>
              <th>User</th>
              <th>Question</th>
              <th>Closest topics</th>
              <th>Reply-to</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.ticketId}>
                <td data-label="When">{dayAndTime(t.createdAt)}</td>
                <td data-label="Ticket" title={t.ticketId}>
                  {shortId(t.ticketId)} <span className="muted">({t.status})</span>
                </td>
                <td data-label="User" title={t.userId}>
                  {shortId(t.userId)}
                </td>
                <td data-label="Question">{t.question}</td>
                <td data-label="Closest topics">{t.matchedTopics.length ? t.matchedTopics.join(' · ') : '—'}</td>
                <td data-label="Reply-to">{t.replyTo ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
