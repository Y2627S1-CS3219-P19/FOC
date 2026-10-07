import type pg from 'pg';
import type { Logger } from 'pino';
import type { Authenticator, SessionChecker } from '@foc/shared-middleware';
import type { Config } from './config.js';

export interface AppContext {
  config: Config;
  pool: pg.Pool;
  auth: Authenticator;
  /** Asks the User Service whether the caller's session is still live and not suspended (cached 5s). */
  sessions: SessionChecker;
  logger: Logger;
}
