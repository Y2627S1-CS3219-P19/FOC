import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { FaqUnavailable } from '../components';
import { faqAnchor, useFaq } from '../faq';

/**
 * Floating help chat, bottom-right on every signed-in page. Escalation is user-decided:
 * the raise form is available at any time, and a refusal pre-fills it.
 */
export function FaqChatWidget() {
  const { claims } = useAuth();
  const faq = useFaq(claims?.email);
  const [open, setOpen] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);

  const res = faq.res;
  const refused = res?.answer === null;
  // The form opens only when the user clicks; a refusal just offers it (see faq.raiseHint).
  const showRaise = raiseOpen;

  const toggle = () => {
    setOpen(!open);
    if (open) faq.reset();
  };

  const close = () => {
    setOpen(false);
    faq.reset();
  };

  return (
    <>
      {open && (
        <div className="faq-popup card stack" role="dialog" aria-label="Ask about FoC">
          <span className="eyebrow">Ask about FoC</span>
          {faq.unavailable && <FaqUnavailable />}
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
              <p className="small">{res.answer}</p>
              <p className="small muted">
                {res.citations.map((c) => (
                  <Link
                    key={c.index}
                    to={`/faq#${faqAnchor(c.source, c.heading)}`}
                    style={{ display: 'block' }}
                    onClick={close}
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
              <p className="small">{faq.lastAnswer.response.answer}</p>
              {faq.lastAnswer.response.citations.map((c) => (
                <Link
                  key={c.index}
                  to={`/faq#${faqAnchor(c.source, c.heading)}`}
                  className="small"
                  onClick={close}
                >
                  – {c.heading}
                </Link>
              ))}
            </div>
          )}
          {refused && (
            <div className="stack">
              <p className="small muted">
                I'm not sure about that one. Closest topics: {res.suggestions.length === 0 && 'none found'}
              </p>
              {res.suggestions.map((s) => (
                <Link
                  key={s.heading}
                  to={`/faq#${faqAnchor(s.source, s.heading)}`}
                  className="small"
                  onClick={close}
                >
                  – {s.heading}
                </Link>
              ))}
            </div>
          )}
          {faq.ticket ? (
            <p className="small">
              Support request created ({faq.ticket.ticketId}). An admin will reach out to {faq.replyTo || 'your account email'}.
            </p>
          ) : showRaise ? (
            (
              <div className="stack">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <p className="small" style={{ margin: 0 }}>
                    Raise a support request and we'll reach back.
                  </p>
                  <button className="ghost small" onClick={() => setRaiseOpen(false)}>
                    Close
                  </button>
                </div>
                {raiseOpen && (
                  <label>
                    Your question
                    <textarea
                      rows={2}
                      value={faq.ticketQuestion}
                      onChange={(e) => faq.setTicketQuestion(e.target.value)}
                      aria-label="Your question"
                    />
                  </label>
                )}
                {faq.ticketError && <p className="small">{faq.ticketError}</p>}
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
            )
          ) : null}
          {!raiseOpen && !faq.ticket && (
            <button className="ghost small" onClick={() => setRaiseOpen(true)}>
              Raise a support request
            </button>
          )}
        </div>
      )}
      <button className="faq-fab" aria-label={open ? 'Close help chat' : 'Open help chat'} onClick={toggle}>
        {open ? '×' : '?'}
      </button>
    </>
  );
}
