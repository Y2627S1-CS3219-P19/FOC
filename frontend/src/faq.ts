import { useCallback, useState } from 'react';
import { ApiError, useApi } from './api';

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

/** One message for any unavailability. 502 is nginx when the service is down entirely. */
export const FAQ_UNAVAILABLE_MESSAGE = 'The FAQ service is currently unavailable. Please try again in a few minutes.';
export const SUPPORT_UNAVAILABLE_MESSAGE = 'Support requests are temporarily unavailable. Please try again later.';

const isFaqUnavailable = (err: unknown) =>
  err instanceof ApiError && (err.code === 'FAQ_UNAVAILABLE' || [502, 503, 504].includes(err.status));

const isSupportUnavailable = (err: unknown) =>
  err instanceof ApiError && (err.code === 'SUPPORT_UNAVAILABLE' || [502, 503, 504].includes(err.status));

/** Stable DOM id for a KB entry, shared by the browse list and the citation links. */
export function faqAnchor(source: string, heading: string): string {
  const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `faq-${slug(source.replace(/\.md$/, ''))}-${slug(heading)}`;
}

/** A raised support request, as the admin triage list returns it. */
export type TicketStatus = 'open' | 'under_review' | 'resolved' | 'wont_fix';

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
  // The last good answer, kept so a refusal or a failed ask cannot erase what the user already read.
  const [lastAnswer, setLastAnswer] = useState<{ question: string; response: FaqAnswer } | null>(null);
  // Capability as the user experiences it: the service is down, so don't show an ask box.
  const [unavailable, setUnavailable] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState(email ?? '');
  // Pre-filled ticket question/topics, set from a refusal (or by the user) before raising.
  const [ticketQuestion, setTicketQuestion] = useState('');
  const [matchedTopics, setMatchedTopics] = useState<string[]>([]);

  const ask = useCallback(async () => {
    if (question.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api<FaqResponse>('POST', '/v1/faq/ask', { question: question.trim() });
      setUnavailable(false);
      setRes(response);
      if (response.answer !== null) setLastAnswer({ question: question.trim(), response });
      if (response.answer === null) {
        setTicketQuestion(response.escalation.question);
        setMatchedTopics(response.escalation.matchedTopics);
      }
    } catch (err) {
      if (isFaqUnavailable(err)) {
        setUnavailable(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Try again later.');
      }
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
      setTicketError(null);
      try {
        setTicket(
          await api<TicketCreated>('POST', '/v1/faq/support-requests', {
            question: text,
            matchedTopics,
            replyTo: replyTo.trim() || undefined,
          }),
        );
      } catch (err) {
        // Tickets can be down while asking still works: say so instead of a generic error.
        setTicketError(
          isSupportUnavailable(err)
            ? SUPPORT_UNAVAILABLE_MESSAGE
            : err instanceof Error
              ? err.message
              : 'Could not create the support request.',
        );
      } finally {
        setBusy(false);
      }
    },
    [api, busy, matchedTopics, replyTo, ticketQuestion],
  );

  // A refusal *offers* the raise form; it never opens or pins it. The last ask event decides.
  const refused = res?.answer === null;
  const raiseHint = refused && !ticket;

  const reset = useCallback(() => {
    setQuestion('');
    setRes(null);
    setLastAnswer(null);
    setTicket(null);
    setError(null);
    setUnavailable(false);
    setTicketError(null);
    setTicketQuestion('');
    setMatchedTopics([]);
  }, []);

  return {
    question, setQuestion, res, ticket, busy, error, replyTo, setReplyTo,
    ticketQuestion, setTicketQuestion, matchedTopics, setMatchedTopics,
    unavailable, ticketError, lastAnswer, refused, raiseHint, ask, raiseTicket, reset,
  };
}
