import type { AppContext } from './context.js';
import type { RetrievedChunk, Retrieve } from './retrieval.js';

export interface FaqCitation {
  index: number;
  source: string;
  heading: string;
}

export interface FaqAnswer {
  answer: string;
  citations: FaqCitation[];
  sources: string[];
}

export interface FaqRefusal {
  answer: null;
  suggestions: { source: string; heading: string }[];
  escalation: { question: string; matchedTopics: string[]; userId: string };
}

export type FaqResponse = FaqAnswer | FaqRefusal;

/**
 * Generation prompt: the model may only use the numbered passages and must cite them.
 * Any answer that cannot be grounded in the passages should say so instead of guessing.
 */
export function buildPrompt(question: string, chunks: RetrievedChunk[]): string {
  const passages = chunks
    .map((c, i) => `[${i + 1}] (${c.doc.metadata.source} — ${c.doc.metadata.heading})\n${c.doc.pageContent}`)
    .join('\n\n');
  return [
    'You are the Friend on Campus (FoC) support assistant.',
    'Answer the user question using ONLY the numbered passages below.',
    'Cite the passages you used inline as [1], [2] and so on.',
    'If the passages do not contain the answer, reply exactly: I do not know.',
    '',
    'Passages:',
    passages,
    '',
    `Question: ${question}`,
  ].join('\n');
}

function citedIndexes(answer: string, chunkCount: number): number[] {
  const raw = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  return [...new Set(raw)].filter((n) => n >= 1 && n <= chunkCount).sort((a, b) => a - b);
}

/**
 * The ask path: retrieve top-k, refuse below the similarity floor, otherwise generate a grounded
 * answer. The refusal carries everything the F28.3 escalation (support email) needs.
 */
export async function ask(
  ctx: Pick<AppContext, 'config' | 'generate'> & { retrieve: Retrieve },
  question: string,
  userId: string,
): Promise<FaqResponse> {
  const { retrieve, config, generate } = ctx;
  const chunks = await retrieve(question, config.topK);

  const best = chunks[0];
  if (!best || best.similarity < config.similarityFloor) {
    return {
      answer: null,
      suggestions: chunks.slice(0, 3).map((c) => ({
        source: c.doc.metadata.source as string,
        heading: c.doc.metadata.heading as string,
      })),
      escalation: {
        question,
        matchedTopics: chunks.map((c) => c.doc.metadata.heading as string),
        userId,
      },
    };
  }

  const answer = (await generate(buildPrompt(question, chunks))).trim();
  if (answer === 'I do not know.' || answer === 'I do not know') {
    return {
      answer: null,
      suggestions: chunks.slice(0, 3).map((c) => ({
        source: c.doc.metadata.source as string,
        heading: c.doc.metadata.heading as string,
      })),
      escalation: { question, matchedTopics: chunks.map((c) => c.doc.metadata.heading as string), userId },
    };
  }

  const used = citedIndexes(answer, chunks.length);
  const cited = (used.length ? used : [1]).map((index) => ({
    index,
    source: chunks[index - 1].doc.metadata.source as string,
    heading: chunks[index - 1].doc.metadata.heading as string,
  }));
  return {
    answer,
    citations: cited,
    sources: [...new Set(cited.map((c) => c.source))],
  };
}
