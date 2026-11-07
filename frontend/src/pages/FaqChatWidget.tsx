import { useState } from 'react';
import { useAuth } from '../auth';
import { useFaq } from '../faq';

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
  const showRaise = raiseOpen || refused;

  const toggle = () => {
    setOpen(!open);
    if (open) faq.reset();
  };

  return (
    <>
      {open && (
        <div className="faq-popup card stack" role="dialog" aria-label="Ask about FoC">
          <span className="eyebrow">Ask about FoC</span>
          <div className="row">
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
              <p className="small muted">{res.citations.map((c) => `– ${c.heading}`).join('\n')}</p>
            </div>
          )}
          {refused && (
            <p className="small muted">
              I'm not sure about that one. Closest topics:{' '}
              {res.suggestions.map((s) => s.heading).join(' · ') || 'none found'}.
            </p>
          )}
          {showRaise &&
            (faq.ticket ? (
              <p className="small">
                Support request created ({faq.ticket.ticketId}). An admin will reach out to {faq.replyTo || 'your account email'}.
              </p>
            ) : (
              <div className="stack">
                <p className="small">Still stuck? Raise a support request and we'll reach back.</p>
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
            ))}
          {!raiseOpen && !refused && (
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
