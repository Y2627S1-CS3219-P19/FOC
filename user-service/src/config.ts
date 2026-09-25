import { z } from 'zod';

const csv = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3001),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  KEYCLOAK_INTERNAL_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_REALM: z.string().default('campuserrand'),
  KC_USER_SERVICE_CLIENT_ID: z.string().default('user-service'),
  KC_USER_SERVICE_CLIENT_SECRET: z.string().min(1),
  ALLOWED_TOKEN_CLIENTS: z.string().default('campuserrand-spa,campuserrand-test'),
  SPA_CLIENT_ID: z.string().default('campuserrand-spa'),
  SPA_URL: z.string().url().default('http://localhost:5173'),
  INTERNAL_AUTH_SECRET: z.string().min(8),
  ALLOWED_EMAIL_DOMAINS: z.string().default('u.nus.edu'),
  ADMIN_CONTACT_EMAIL: z.string().email().default('foc-admin@u.nus.edu'),
  REGISTER_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(5),
  VERIFY_EMAIL_LIFESPAN_SECONDS: z.coerce.number().int().default(86_400),
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional().default(''),
  BOOTSTRAP_ADMIN_USERNAME: z.string().optional().default('admin'),
  BOOTSTRAP_ADMIN_TEMP_PASSWORD: z.string().optional().default(''),
  AMQP_URL: z.string().optional().default(''),
  DEBUG_EVENT_QUEUE: z.string().optional().default('false'),
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
      clientId: e.KC_USER_SERVICE_CLIENT_ID,
      clientSecret: e.KC_USER_SERVICE_CLIENT_SECRET,
    },
    allowedTokenClients: csv(e.ALLOWED_TOKEN_CLIENTS),
    spaClientId: e.SPA_CLIENT_ID,
    spaUrl: e.SPA_URL.replace(/\/$/, ''),
    internalAuthSecret: e.INTERNAL_AUTH_SECRET,
    allowedEmailDomains: csv(e.ALLOWED_EMAIL_DOMAINS),
    adminContactEmail: e.ADMIN_CONTACT_EMAIL,
    registerRateLimitPerHour: e.REGISTER_RATE_LIMIT_PER_HOUR,
    verifyEmailLifespanSeconds: e.VERIFY_EMAIL_LIFESPAN_SECONDS,
    bootstrapAdmin: {
      email: e.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase(),
      username: (e.BOOTSTRAP_ADMIN_USERNAME || 'admin').trim().toLowerCase(),
      tempPassword: e.BOOTSTRAP_ADMIN_TEMP_PASSWORD,
    },
    amqpUrl: e.AMQP_URL,
    debugEventQueue: e.DEBUG_EVENT_QUEUE === 'true',
    trustProxy: e.TRUST_PROXY ? (Number.isNaN(Number(e.TRUST_PROXY)) ? e.TRUST_PROXY : Number(e.TRUST_PROXY)) : false,
  };
}
