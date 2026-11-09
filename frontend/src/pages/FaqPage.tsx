import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApi } from '../api';
import { useAuth } from '../auth';
import { FaqUnavailable } from '../components';
import { faqAnchor, useFaq, type FaqEntry } from '../faq';

/** The dedicated FAQ page: browse the knowledge base, ask the bot, or raise a support request. */
export function FaqPage() {
  const { claims } = useAuth();
  const api = useApi();
  const [entries, setEntries] = useState<FaqEntry[] | null>(null);
  const [entriesError, setEntriesError] = useState<unknown>(null);
  const faq = useFaq(claims?.email);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [openEntries, setOpenEntries] = useState<Set<string>>(new Set());
  const location = useLocation();

  useEffect(() => {
    api<{ data: FaqEntry[] }>('GET', '/v1/faq/entries').then(
      (r) => setEntries(r.data),
      (err) => setEntriesError(err),
    );
  }, [api]);

  // A citation link (/faq#entry-id) expands and scrolls to that knowledge-base entry.
  useEffect(() => {
    if (!entries || !location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    if (!entries.some((e) => faqAnchor(e.source, e.heading) === id)) return;
    setOpenEntries((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [entries, location]);

  const res = faq.res;
  const refused = res?.answer === null;
  // The form opens only when the user clicks; a refusal just offers it (see faq.raiseHint).
  const showRaise = raiseOpen;

  return (
    <div className="stack narrow" style={{ margin: '24px auto' }}>
      <h1>FAQ</h1>

      <div className="card soft stack">
        <span className="eyebrow">Ask about FoC</span>
        {faq.unavailable && <FaqUnavailable email={claims?.email} />}
        <div className="row" hidden={faq.unavailable}>
          <input
            placeholder="e.g. how do credits move?"
            value={faq.question}
            onChange={(e) => faq.setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && faq.ask()}
            aria-label="Ask a question about FoC"
          />
          <button className="button" onClick={faq.ask} disabled={faq.busy || faq.question.trim().length < 3}>
            {faq.busy ? 'Thinking…' : 'Ask'}
          </button>
        </div>
        {faq.error && <p className="small">{faq.error}</p>}
        {res && res.answer !== null && (
          <div className="stack">
            <p>{res.answer}</p>
            <p className="small muted">
              {res.citations.map((c) => (
                <Link
                  key={c.index}
                  to={`/faq#${faqAnchor(c.source, c.heading)}`}
                  style={{ display: 'block' }}
                >
                  – {c.heading}
                </Link>
              ))}
            </p>
          </div>
        )}
        {refused && faq.lastAnswer && (
          <div className="stack">
            <p className="small muted">Your earlier question: “{faq.lastAnswer.question}”</p>
            <p>{faq.lastAnswer.response.answer}</p>
            {faq.lastAnswer.response.citations.map((c) => (
              <Link key={c.index} to={`/faq#${faqAnchor(c.source, c.heading)}`} className="small">
                – {c.heading}
              </Link>
            ))}
          </div>
        )}
        {refused && (
          <div className="stack">
            <p className="small muted">
              I'm not sure about that one. Closest topics:{' '}
              {res.suggestions.length === 0 && 'none found'}
            </p>
            {res.suggestions.map((s) => (
              <Link key={s.heading} to={`/faq#${faqAnchor(s.source, s.heading)}`} className="small">
                – {s.heading}
              </Link>
            ))}
            {faq.raiseHint && !showRaise && (
              <button className="ghost small" onClick={() => setRaiseOpen(true)}>
                Still stuck? Raise a support request
              </button>
            )}
          </div>
        )}
      </div>

      {(showRaise || faq.ticket) && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="eyebrow">Raise a support request</span>
            {showRaise && (
              <button className="ghost small" onClick={() => setRaiseOpen(false)}>
                Close
              </button>
            )}
          </div>
          {faq.ticket ? (
            <p className="small">
              Support request created ({faq.ticket.ticketId}). An admin will reach out to{' '}
              {faq.replyTo || 'your account email'}.
            </p>
          ) : (
            <div className="stack">
              <p className="small">Stuck? Send your question to the team and we'll reach back.</p>
              {faq.ticketError && <p className="small">{faq.ticketError}</p>}
              <label>
                Your question
                <textarea
                  rows={3}
                  value={faq.ticketQuestion}
                  onChange={(e) => faq.setTicketQuestion(e.target.value)}
                  aria-label="Your question"
                />
              </label>
              <label className="small">
                Reply-to email
                <input
                  value={faq.replyTo}
                  onChange={(e) => faq.setReplyTo(e.target.value)}
                  placeholder="your email"
                  aria-label="Reply-to email"
                />
              </label>
              <button
                className="button"
                onClick={() => faq.raiseTicket()}
                disabled={faq.busy || faq.ticketQuestion.trim().length < 3}
              >
                {faq.busy ? 'Sending…' : 'Raise a support request'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card stack">
        {entriesError ? <FaqUnavailable email={claims?.email} /> : null}
        {!entries && !entriesError && <p className="small muted">Loading…</p>}
        {entries?.length === 0 && <p className="small muted">The knowledge base is empty.</p>}
        {entries?.map((e) => {
          const id = faqAnchor(e.source, e.heading);
          return (
            <details
              key={id}
              id={id}
              className="faq-entry"
              open={openEntries.has(id)}
              onToggle={(ev) => {
                const isOpen = ev.currentTarget.open;
                setOpenEntries((prev) => {
                  const next = new Set(prev);
                  if (isOpen) next.add(id);
                  else next.delete(id);
                  return next;
                });
              }}
            >
              <summary>{e.heading}</summary>
              <p className="small">{e.content}</p>
            </details>
          );
        })}
      </div>
    </div>
  );
}
