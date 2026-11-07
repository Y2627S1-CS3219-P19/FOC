import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3005),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: z.string().optional().default(''),
  CHROMA_URL: z.string().url().default('http://localhost:8000'),
  FAQ_COLLECTION: z.string().default('foc_faq'),
  FAQ_DATABASE_URL: z.string().min(1),
  FAQ_TOP_K: z.coerce.number().int().min(1).max(20).default(4),
  // Minimum cosine similarity (1 - chroma distance) for an answer; below it the bot refuses.
  FAQ_SIMILARITY_FLOOR: z.coerce.number().min(0).max(1).default(0.35),
  FAQ_SUPPORT_EMAIL: z.string().email().default('foc-support@u.nus.edu'),
  GEMINI_API_KEY: z.string().min(1),
  FAQ_EMBED_MODEL: z.string().default('gemini-embedding-001'),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  FAQ_GEN_MODEL: z.string().default('google/gemini-2.5-flash'),
  KEYCLOAK_INTERNAL_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_REALM: z.string().default('campuserrand'),
  ALLOWED_TOKEN_CLIENTS: z.string().default('campuserrand-spa,campuserrand-test'),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = EnvSchema.parse(env);
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    chromaUrl: e.CHROMA_URL,
    collection: e.FAQ_COLLECTION,
    databaseUrl: e.FAQ_DATABASE_URL,
    topK: e.FAQ_TOP_K,
    similarityFloor: e.FAQ_SIMILARITY_FLOOR,
    supportEmail: e.FAQ_SUPPORT_EMAIL,
    geminiApiKey: e.GEMINI_API_KEY,
    embedModel: e.FAQ_EMBED_MODEL,
    openRouterApiKey: e.OPENROUTER_API_KEY,
    openRouterBaseUrl: e.OPENROUTER_BASE_URL,
    genModel: e.FAQ_GEN_MODEL,
    keycloak: {
      internalUrl: e.KEYCLOAK_INTERNAL_URL.replace(/\/$/, ''),
      publicUrl: e.KEYCLOAK_PUBLIC_URL.replace(/\/$/, ''),
      realm: e.KEYCLOAK_REALM,
      allowedTokenClients: e.ALLOWED_TOKEN_CLIENTS.split(',').map((s) => s.trim()).filter(Boolean),
    },
  };
}
