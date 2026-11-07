import { useState } from 'react';
import { useApi } from '../api';

interface FaqAnswer {
  answer: string;
  citations: { index: number; source: string; heading: string }[];
}

interface FaqRefusal {
  answer: null;
  suggestions: { source: string; heading: string }[];
  escalation: { question: string; matchedTopics: string[]; userId: string };
}

type FaqResponse = FaqAnswer | FaqRefusal;

interface TicketCreated {
  ticketId: string;
  status: string;
}

/** "Ask about FoC" box (F28.2 + F28.3): grounded answers; refusal escalates to a login-gated ticket. */
export function FaqCard({ email }: { email?: string }) {
  const api = useApi();
  const [question, setQuestion] = useState('');
  const [res, setRes] = useState<FaqResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState(email ?? '');
  const [ticket, setTicket] = useState<TicketCreated | null>(null);

  const ask = async () => {
    if (question.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setTicket(null);
    try {
      setRes(await api('POST', '/v1/faq/ask', { question: question.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again later.');
    } finally {
      setBusy(false);
    }
  };

  // F28.3: the ticket is created server-side against the verified token; replyTo is only a
  // reply-to convenience (pre-filled from the token's verified email claim, editable here).
  const raiseTicket = async (escalation: Extract<FaqResponse, { answer: null }>['escalation']) => {
    setBusy(true);
    setError(null);
    try {
      setTicket(
        await api('POST', '/v1/faq/support-requests', {
          question: escalation.question,
          matchedTopics: escalation.matchedTopics,
          replyTo: replyTo.trim() || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the support request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card soft stack">
      <span className="eyebrow">Ask about FoC</span>
      <div className="row">
        <input
          placeholder="e.g. how do credits move?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          aria-label="Ask a question about FoC"
        />
        <button className="button" onClick={ask} disabled={busy || question.trim().length < 3}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </div>
      {error && <p className="small">{error}</p>}
      {res?.answer !== undefined && res.answer !== null && (
        <div className="stack">
          <p>{res.answer}</p>
          <p className="small muted">{res.citations.map((c) => `– ${c.heading}`).join('\n')}</p>
        </div>
      )}
      {res && res.answer === null && (
        <div className="stack">
          <p className="small muted">
            I'm not sure about that one. Closest topics:{' '}
            {res.suggestions.map((s) => s.heading).join(' · ') || 'none found'}.
          </p>
          {ticket ? (
            <p className="small">
              Support request created ({ticket.ticketId}). An admin will reach out to {replyTo || 'your account email'}.
            </p>
          ) : (
            <div className="stack">
              <p className="small">Still stuck? Raise a support request and we'll reach back.</p>
              <label className="small">
                Reply-to email
                <input
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="your email"
                  aria-label="Reply-to email"
                />
              </label>
              <button className="button" onClick={() => raiseTicket(res.escalation)} disabled={busy}>
                Raise a support request
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
