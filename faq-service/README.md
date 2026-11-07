# FAQ Service (FoC customer relations — F28)

RAG-based FAQ chatbot. Signed-in students ask questions in natural language and get answers
grounded in the curated FAQ corpus, with citations. Questions the corpus cannot answer get a
refusal with the nearest topics and an escalation payload (F28.3).

- **F28.1** knowledge base: `corpus/faq.md` (primary, hand-written) — one chunk per `## heading`.
- **F28.2** conversational assistance: `POST /v1/faq/ask` — retrieve top-k from Chroma, generate
  with a strict "answer only from these passages, cite them" prompt.
- **F28.3** support escalation: refusals carry `{ escalation: { question, matchedTopics, userId } }`;
  the frontend turns that into a prefilled support email (mailto; server-side SES is the documented
  production path).

## Stack

Express 5 + `@foc/shared-middleware` (auth, error envelope, logging) — same as user/credit/order
services. LangChain.js components (`@langchain/core` `VectorStore`, `@langchain/google-genai`
embeddings, `@langchain/openai` chat client) over hand-written retrieval/prompt logic. No SQL
database: Chroma is the only store.

| Piece | Choice | Why |
| --- | --- | --- |
| Vector store | Chroma (`chromadb/chroma:1.5.9`) | dedicated vector DB; HNSW cosine; user decision |
| Embeddings | `gemini-embedding-001` (config `FAQ_EMBED_MODEL`) | top-3 MTEB eng-v2, best managed model |
| Generation | OpenRouter chat client (`FAQ_GEN_MODEL`, default `google/gemini-2.5-flash`) | model swapped by config for experiments |

Bedrock was the first choice but the NUS AWS organisation SCP denies `bedrock:InvokeModel`
account-wide (verified 5 Nov). The model layer is provider-agnostic by design: embeddings and
generation are each one module (`src/modelClient.ts`), and the store is behind `FaqStore`
(`src/chroma.ts`) — swapping to pgvector (the lower-infra fallback), Qdrant or Bedrock is one
module change plus a re-ingest.

## Environment

| Key | Purpose |
| --- | --- |
| `CHROMA_URL` | Chroma server URL (compose sets `http://chroma:8000`) |
| `GEMINI_API_KEY` | Google AI Studio key for embeddings |
| `OPENROUTER_API_KEY` | OpenRouter key for generation |
| `FAQ_EMBED_MODEL` / `FAQ_GEN_MODEL` | model ids (swap + re-ingest) |
| `FAQ_TOP_K`, `FAQ_SIMILARITY_FLOOR` | retrieval tuning (default 4 / 0.35 cosine similarity) |
| `FAQ_SUPPORT_EMAIL` | support address for the F28.3 escalation |

## Ingestion

```bash
npm run ingest -w faq-service   # chunks corpus/*.md by ## heading, upserts into Chroma
```

Idempotent: chunk ids are `source#heading-slug`, so re-running updates in place. Re-run after any
corpus or embedding-model change (a model change re-embeds everything).

## Run

```bash
docker compose up -d --build chroma faq-service   # or the whole stack
npm run ingest -w faq-service                      # build the knowledge base
```

API: `POST /v1/faq/ask {question}` and `GET /v1/faq/search?q=` — bearer token required
(`requireAuth`, Keycloak). Docs of the error envelope match every other FoC service.
