import { useCallback, useState } from 'react';
import { useApi } from './api';

export interface FaqEntry {
  source: string;
  heading: string;
  content: string;
}

export interface FaqAnswer {
  answer: string;
  citations: { index: number; source: string; heading: string }[];
}

export interface FaqRefusal {
  answer: null;
  suggestions: { source: string; heading: string }[];
  escalation: { question: string; matchedTopics: string[] };
}

export type FaqResponse = FaqAnswer | FaqRefusal;

export interface TicketCreated {
  ticketId: string;
  status: string;
}

/** Stable DOM id for a KB entry, shared by the browse list and the citation links. */
export function faqAnchor(source: string, heading: string): string {
  const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `faq-${slug(source.replace(/\.md$/, ''))}-${slug(heading)}`;
}

/** A raised support request, as the admin triage list returns it. */
export type TicketStatus = 'open' | 'under_review' | 'resolved';

export interface TicketHistoryEntry {
  fromStatus: string | null;
  toStatus: string;
  adminId: string | null;
  createdAt: string;
}

export interface FaqTicket {
  ticketId: string;
  question: string;
  matchedTopics: string[];
  replyTo?: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  history: TicketHistoryEntry[];
}

/**
 * Shared ask + raise-ticket state for the FAQ page and the chat popup.
 * Escalation is user-decided: a ticket can be raised at any time, not only after a refusal.
 */
export function useFaq(email?: string) {
  const api = useApi();
  const [question, setQuestion] = useState('');
  const [res, setRes] = useState<FaqResponse | null>(null);
  const [ticket, setTicket] = useState<TicketCreated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState(email ?? '');
  // Pre-filled ticket question/topics, set from a refusal (or by the user) before raising.
  const [ticketQuestion, setTicketQuestion] = useState('');
  const [matchedTopics, setMatchedTopics] = useState<string[]>([]);

  const ask = useCallback(async () => {
    if (question.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setTicket(null);
    try {
      const response = await api<FaqResponse>('POST', '/v1/faq/ask', { question: question.trim() });
      setRes(response);
      if (response.answer === null) {
        setTicketQuestion(response.escalation.question);
        setMatchedTopics(response.escalation.matchedTopics);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again later.');
    } finally {
      setBusy(false);
    }
  }, [api, busy, question]);

  // The ticket is created server-side against the verified token; replyTo is only a reply-to
  // convenience (pre-filled from the token's verified email claim, editable here).
  const raiseTicket = useCallback(
    async (q?: string) => {
      const text = (q ?? ticketQuestion).trim();
      if (text.length < 3 || busy) return;
      setBusy(true);
      setError(null);
      try {
        setTicket(
          await api<TicketCreated>('POST', '/v1/faq/support-requests', {
            question: text,
            matchedTopics,
            replyTo: replyTo.trim() || undefined,
          }),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create the support request.');
      } finally {
        setBusy(false);
      }
    },
    [api, busy, matchedTopics, replyTo, ticketQuestion],
  );

  const reset = useCallback(() => {
    setQuestion('');
    setRes(null);
    setTicket(null);
    setError(null);
    setTicketQuestion('');
    setMatchedTopics([]);
  }, []);

  return {
    question, setQuestion, res, ticket, busy, error, replyTo, setReplyTo,
    ticketQuestion, setTicketQuestion, matchedTopics, setMatchedTopics,
    ask, raiseTicket, reset,
  };
}
