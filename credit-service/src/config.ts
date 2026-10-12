import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3003),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  KEYCLOAK_INTERNAL_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_REALM: z.string().default('campuserrand'),
  ALLOWED_TOKEN_CLIENTS: z.string().default('campuserrand-spa,campuserrand-test'),
  USER_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  INTERNAL_AUTH_SECRET: z.string().min(8),
  AMQP_URL: z.string().optional().default(''),
  DEBUG_EVENT_QUEUE: z.string().optional().default('false'),
  INITIAL_CREDIT_BALANCE: z.coerce.number().int().min(0).default(100),
  CONSUMER_RETRY_DELAY_MS: z.coerce.number().int().positive().default(5_000),
  TRUST_PROXY: z.string().optional().default(''),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = EnvSchema.parse(env);
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    keycloak: {
      internalUrl: e.KEYCLOAK_INTERNAL_URL.replace(/\/$/, ''),
      publicUrl: e.KEYCLOAK_PUBLIC_URL.replace(/\/$/, ''),
      realm: e.KEYCLOAK_REALM,
    },
    allowedTokenClients: e.ALLOWED_TOKEN_CLIENTS.split(',').map((s) => s.trim()).filter(Boolean),
    userServiceUrl: e.USER_SERVICE_URL.replace(/\/$/, ''),
    internalAuthSecret: e.INTERNAL_AUTH_SECRET,
    amqpUrl: e.AMQP_URL,
    debugEventQueue: e.DEBUG_EVENT_QUEUE === 'true',
    initialCreditBalance: e.INITIAL_CREDIT_BALANCE,
    consumerRetryDelayMs: e.CONSUMER_RETRY_DELAY_MS,
    trustProxy: e.TRUST_PROXY ? (Number.isNaN(Number(e.TRUST_PROXY)) ? e.TRUST_PROXY : Number(e.TRUST_PROXY)) : false,
  };
}
