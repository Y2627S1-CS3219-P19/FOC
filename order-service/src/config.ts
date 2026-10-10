import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3004),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  KEYCLOAK_INTERNAL_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_REALM: z.string().default('campuserrand'),
  ALLOWED_TOKEN_CLIENTS: z.string().default('campuserrand-spa,campuserrand-test'),
  USER_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  SUPPLIER_SERVICE_URL: z.string().url().default('http://localhost:3002'),
  INTERNAL_AUTH_SECRET: z.string().min(8),
  AMQP_URL: z.string().optional().default(''),
  DEBUG_EVENT_QUEUE: z.string().optional().default('false'),
  TRUST_PROXY: z.string().optional().default(''),
  EXPIRY_SWEEP_MS: z.coerce.number().int().positive().default(30_000),
  AUTO_CONFIRM_AFTER_HOURS: z.coerce.number().positive().default(24),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
  PENDING_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
  CONSUMER_RETRY_DELAY_MS: z.coerce.number().int().positive().default(5_000),
});

export type Config = ReturnType<typeof loadConfig>;

const noSlash = (url: string) => url.replace(/\/$/, '');

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = EnvSchema.parse(env);
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    keycloak: {
      internalUrl: noSlash(e.KEYCLOAK_INTERNAL_URL),
      publicUrl: noSlash(e.KEYCLOAK_PUBLIC_URL),
      realm: e.KEYCLOAK_REALM,
    },
    allowedTokenClients: e.ALLOWED_TOKEN_CLIENTS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    userServiceUrl: noSlash(e.USER_SERVICE_URL),
    supplierServiceUrl: noSlash(e.SUPPLIER_SERVICE_URL),
    internalAuthSecret: e.INTERNAL_AUTH_SECRET,
    amqpUrl: e.AMQP_URL,
    debugEventQueue: e.DEBUG_EVENT_QUEUE === 'true',
    trustProxy: e.TRUST_PROXY ? (Number.isNaN(Number(e.TRUST_PROXY)) ? e.TRUST_PROXY : Number(e.TRUST_PROXY)) : false,
    expirySweepMs: e.EXPIRY_SWEEP_MS,
    autoConfirmAfterHours: e.AUTO_CONFIRM_AFTER_HOURS,
    httpTimeoutMs: e.HTTP_TIMEOUT_MS,
    pendingTimeoutSeconds: e.PENDING_TIMEOUT_SECONDS,
    consumerRetryDelayMs: e.CONSUMER_RETRY_DELAY_MS,
  };
}
