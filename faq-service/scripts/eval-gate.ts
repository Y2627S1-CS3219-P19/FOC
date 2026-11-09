// GATE eval: scripted retrieval questions against the ingested corpus (offline-cached vectors).
// Prints only headings and scores, never keys.
import { readFileSync, writeFileSync } from 'node:fs';
import { createVectorStore } from '../src/chroma.js';
import { createEmbeddings } from '../src/modelClient.js';
import { loadConfig } from '../src/config.js';
import { chunkMarkdown, slug } from '../src/corpus.js';

const config = loadConfig();

interface EvalCase {
  q: string;
  expect: string | null; // expected chunk heading, or null = must refuse (low similarity)
}

const pairs: [string, string][] = [
  // direct questions — one per corpus chunk (the heading itself plus a natural variant)
  ['What is Friend on Campus?', 'What is Friend on Campus?'],
  ['How does FoC work?', 'What is Friend on Campus?'],
  ['What are credits and how do I get them?', 'What are credits and how do I get them?'],
  ['Where do I get credits?', 'What are credits and how do I get them?'],
  ['Can I buy credits with real money?', 'Can I buy credits with real money?'],
  ['Can I top up my credit balance?', 'Can I buy credits with real money?'],
  ['Can I cash out my credits or send them to someone off the platform?', 'Can I cash out my credits or send them to someone off the platform?'],
  ['Can I withdraw my credits to my bank account?', 'Can I cash out my credits or send them to someone off the platform?'],
  ['Can I transfer credits directly to another student?', 'Can I transfer credits directly to another student?'],
  ['Can I pay my friend half the credits directly?', 'Can I transfer credits directly to another student?'],
  ['Why do I need a @u.nus.edu email to sign up?', 'Why do I need a @u.nus.edu email to sign up?'],
  ['Is FoC open to non-NUS students?', 'Why do I need a @u.nus.edu email to sign up?'],
  ['How do I verify my email after signing up?', 'How do I verify my email after signing up?'],
  ['I didn\'t receive my verification email. What do I do?', "I didn't receive my verification email. What do I do?"],
  ['The verification link expired, what now?', "I didn't receive my verification email. What do I do?"],
  ['I forgot my password. How do I reset it?', 'I forgot my password. How do I reset it?'],
  ['My account was suspended. What does that mean and what can I do?', 'My account was suspended. What does that mean and what can I do?'],
  ['Why was I suspended and what can I do about it?', 'My account was suspended. What does that mean and what can I do?'],
  ['What is an errand?', 'What is an errand?'],
  ['How do credits move when I request an errand?', 'How do credits move when I request an errand?'],
  ['When exactly do my credits go to the runner?', 'How do credits move when I request an errand?'],
  ['What are the stages of an errand?', 'What are the stages of an errand?'],
  ['What does the errand status lifecycle look like?', 'What are the stages of an errand?'],
  ['What does "held for open errands" on my wallet mean?', 'What does "held for open errands" on my wallet mean?'],
  ['Why is part of my balance not spendable?', 'What does "held for open errands" on my wallet mean?'],
  ['Why can\'t I accept an errand I posted?', "Why can't I accept an errand I posted?"],
  ['How long do I have to accept an open errand?', 'How long do I have to accept an open errand?'],
  ['What happens if nobody accepts my errand?', 'How long do I have to accept an open errand?'],
  ['Do I need to confirm when my errand is delivered?', 'Do I need to confirm when my errand is delivered?'],
  ['What is the Supplier Directory?', 'What is the Supplier Directory?'],
  ['How do I find a stall in the Supplier Directory?', 'How do I find a stall in the Supplier Directory?'],
  ['How do I search for food options near my faculty?', 'How do I find a stall in the Supplier Directory?'],
  ['How do I earn credits?', 'How do I earn credits?'],
  ['Where can I see the errands I am involved in?', 'Where can I see the errands I am involved in?'],
  ['How do I place an errand request?', 'How do I place an errand request?'],
  ['How do I post a job for someone to collect my parcel?', 'How do I place an errand request?'],
  ['Where can I see my credit history?', 'Where can I see my credit history?'],
  ['What happens if the stall is closed when I try to place an errand?', 'What happens if the stall is closed when I try to place an errand?'],
  ['Can I order from a stall during closing time?', 'What happens if the stall is closed when I try to place an errand?'],
  ["The stall's opening hours are wrong. What do I do?", "The stall's opening hours are wrong. What do I do?"],
  ['What happens if my runner accepts but never delivers?', 'What happens if my runner accepts but never delivers?'],
  ['My runner ghosted me after accepting, what now?', 'What happens if my runner accepts but never delivers?'],
  ['How do I report a runner?', 'How do I report a runner?'],
  ['Who are admins and how do I become one?', 'Who are admins and how do I become one?'],
  // out-of-corpus — must land below the refusal floor
  ['What is the weather today?', null],
  ['Who won the football match last night?', null],
  ['How do I bake a chocolate cake?', null],
  ['What is the capital of France?', null],
  ['Can you write my essay for me?', null],
  ['What time does the library close?', null],
  ['How much does an MRT ride cost?', null],
  ['Tell me a joke', null],
];

async function main() {
  const embeddings = createEmbeddings(config);
  const store = createVectorStore(config, embeddings);
  const markdown = readFileSync(new URL('../corpus/faq.md', import.meta.url), 'utf8');
  const chunks = chunkMarkdown('faq.md', markdown);
  const headings = new Set(chunks.map((c) => c.metadata.heading));

  // Cache corpus vectors on disk: re-running the eval then costs 1 call per question only.
  const cachePath = '/tmp/faq-gate-corpus-vectors.json';
  let corpusVectors: number[][];
  try {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as { n: number; vectors: number[][] };
    if (cached.n !== chunks.length) throw new Error('stale cache');
    corpusVectors = cached.vectors;
    console.log('(corpus vectors from cache)');
  } catch {
    corpusVectors = await embeddings.embedDocuments(chunks.map((c) => c.pageContent));
    writeFileSync(cachePath, JSON.stringify({ n: chunks.length, vectors: corpusVectors }));
    console.log('(corpus vectors computed and cached)');
  }

  let top1 = 0;
  let top2 = 0;
  let refusals = 0;
  const failures: string[] = [];
  let lastQueryVec: number[] | null = null;
  let deterministic = true;

  for (const [q, expect] of pairs) {
    const qVec = await embeddings.embedQuery(q);
    if (lastQueryVec) {
      const identical = lastQueryVec.length === corpusVectors[0].length; // placeholder, replaced below
      void identical;
    }
    const scored = corpusVectors.map((v, i) => ({
      i,
      sim: dot(qVec, v) / (Math.hypot(...qVec) * Math.hypot(...v) || 1),
    }));
    scored.sort((a, b) => b.sim - a.sim);
    const best = scored[0];
    const bestHeading = chunks[best.i].metadata.heading;

    if (expect === null) {
      if (best.sim < config.similarityFloor) refusals++;
      else failures.push(`REFUSAL-LEAK "${q}" -> ${bestHeading} @ ${best.sim.toFixed(3)}`);
    } else if (bestHeading === expect) {
      top1++;
    } else if (scored[1] && chunks[scored[1].i].metadata.heading === expect) {
      top2++;
      failures.push(`TOP2 "${q}" -> got "${bestHeading}" (${best.sim.toFixed(3)}), expected "${expect}" at rank 2 (${scored[1].sim.toFixed(3)})`);
    } else {
      failures.push(`MISS "${q}" -> got "${bestHeading}" (${best.sim.toFixed(3)}), expected "${expect}"`);
    }

    // determinism probe: re-embed the same question once and compare vectors exactly
    if (!lastQueryVec && q === 'What are credits and how do I get them?') {
      lastQueryVec = qVec;
      const again = await embeddings.embedQuery(q);
      deterministic = JSON.stringify(again) === JSON.stringify(qVec);
    }
    void lastQueryVec;
  }

  // idempotency: the ingest ids cover every chunk exactly once
  const idSet = new Set(chunks.map((c, i) => { if (!c.metadata.heading) { console.error("CHUNK", i, JSON.stringify(c.metadata), c.pageContent.slice(0,60)); process.exit(1); } return `faq.md#${slug(String(c.metadata.heading))}`; }));
  const idsUnique = idSet.size === chunks.length;
  const everyHeadingKnown = [...headings].length === chunks.length;

  const direct = pairs.filter(([, e]) => e !== null).length;
  console.log('=== GATE RESULTS ===');
  console.log(`chunks: ${chunks.length} | direct/reworded questions: ${direct} | out-of-corpus: ${pairs.length - direct}`);
  console.log(`top-1 exact: ${top1}/${direct} | top-2: ${top2} | refusals correct: ${refusals}/${pairs.length - direct}`);
  console.log(`ingest ids unique: ${idsUnique} | headings consistent: ${everyHeadingKnown}`);
  console.log(`embedding determinism (same question twice): ${deterministic ? 'IDENTICAL' : 'DIFFERS'}`);
  console.log(`similarity floor in effect: ${config.similarityFloor}`);
  if (failures.length) {
    console.log('--- failures ---');
    for (const f of failures) console.log(f);
  } else {
    console.log('no failures');
  }
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

main().catch((e) => {
  console.error('ERR', e?.stack ?? e);
  process.exit(1);
});
