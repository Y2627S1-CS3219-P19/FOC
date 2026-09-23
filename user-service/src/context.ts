import type { Logger } from 'pino';
import type { Authenticator, CachedSessionChecker } from '@foc/shared-middleware';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import type { KeycloakAdmin } from './keycloak.js';

/** Everything route handlers and services need. Built once in index.ts (or by tests). */
export interface AppContext {
  config: Config;
  pool: Pool;
  kc: KeycloakAdmin;
  auth: Authenticator;
  sessions: CachedSessionChecker;
  logger: Logger;
}
