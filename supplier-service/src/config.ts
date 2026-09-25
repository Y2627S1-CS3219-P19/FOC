import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const defaultDataDir = fileURLToPath(new URL('../../data', import.meta.url));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3002),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  KEYCLOAK_INTERNAL_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_REALM: z.string().default('campuserrand'),
  ALLOWED_TOKEN_CLIENTS: z.string().default('campuserrand-spa,campuserrand-test'),
  USER_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  INTERNAL_AUTH_SECRET: z.string().min(8),
  SEED_CSV_PATH: z.string().default(`${defaultDataDir}/csv/supplier-seed-data.csv`),
  IMAGES_DIR: z.string().default(`${defaultDataDir}/images`),
  SUPPLIER_TIMEZONE: z.string().default('Asia/Singapore'),
  SEED_ON_START: z.string().default('true'),
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
    seedCsvPath: e.SEED_CSV_PATH,
    imagesDir: e.IMAGES_DIR,
    timezone: e.SUPPLIER_TIMEZONE,
    seedOnStart: e.SEED_ON_START === 'true',
  };
}
