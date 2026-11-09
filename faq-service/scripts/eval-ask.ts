// Ask-path eval: real Chroma + Gemini embeddings + OpenRouter generation.
// Needs GEMINI_API_KEY and OPENROUTER_API_KEY; points at a Chroma reachable from the host.
import { buildContext } from '../src/index.js';
import { ask } from '../src/faq.js';

const ANSWERABLE = [
  'What are credits?',
  'Can I buy credits with real money?',
  'Why do I need a @u.nus.edu email?',
  'What are the stages of an errand?',
  'What happens if nobody accepts my errand?',
  'What happens if the stall is closed when I try to place an errand?',
  'How do I report a runner?',
  'How do I earn credits?',
];

const OOC = [
  'What is the weather today?',
  'Who won the football match last night?',
  'How do I bake a chocolate cake?',
  'What is the capital of France?',
  'Can you write my essay for me?',
  'What time does the library close?',
  'How much does an MRT ride cost?',
  'Tell me a joke',
];

async function main() {
  const ctx = buildContext();
  console.log('=== ANSWERABLE (expect answer + citations) ===');
  for (const q of ANSWERABLE) {
    const res = await ask(ctx, q);
    if (res.answer === null) console.log(`REFUSED (unexpected) "${q}"`);
    else console.log(`OK "${q}" -> ${JSON.stringify(res.citations)} :: ${res.answer.slice(0, 110).replace(/\n/g, ' ')}`);
  }
  console.log('=== OUT-OF-CORPUS (expect refusal) ===');
  let refused = 0;
  for (const q of OOC) {
    const res = await ask(ctx, q);
    if (res.answer === null) {
      refused++;
      console.log(`OK refusal "${q}" (suggestions: ${res.suggestions.length})`);
    } else {
      console.log(`HALLUCINATION "${q}" -> ${res.answer.slice(0, 90)}`);
    }
  }
  console.log(`refusals: ${refused}/${OOC.length}`);
}
main().catch((e) => {
  console.error('ERR', e?.stack ?? e);
  process.exit(1);
});
