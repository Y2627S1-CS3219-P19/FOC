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

/** "Ask about FoC" box (F28.2): grounded answers with citations. Hidden for anonymous users by Home. */
export function FaqCard() {
  const api = useApi();
  const [question, setQuestion] = useState('');
  const [res, setRes] = useState<FaqResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (question.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      setRes(await api('POST', '/v1/faq/ask', { question: question.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again later.');
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
          <p className="small muted">
            {res.citations.map((c) => `– ${c.heading}`).join('\n')}
          </p>
        </div>
      )}
      {res && res.answer === null && (
        <p className="small muted">
          I'm not sure about that one. Closest topics:{' '}
          {res.suggestions.map((s) => s.heading).join(' · ') || 'none found'}.
        </p>
      )}
    </div>
  );
}
