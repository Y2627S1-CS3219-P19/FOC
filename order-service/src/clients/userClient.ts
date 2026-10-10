import type { Logger } from 'pino';
import { callInternal, type InternalHttpOptions } from './http.js';

export interface UserSummary {
  id: string;
  displayName: string;
  rating: number | null;
}

export interface UserClient {
  /** Returns null if the user is missing or the User Service fails, so a read never breaks. */
  summary(userId: string, correlationId?: string): Promise<UserSummary | null>;
}

/** GET /v1/internal/users/:id/summary on the User Service. */
export function createUserClient(options: Omit<InternalHttpOptions, 'service'>, logger: Logger): UserClient {
  const http = { ...options, service: 'USER' as const };
  return {
    async summary(userId, correlationId) {
      try {
        const res = await callInternal(http, 'GET', `/v1/internal/users/${encodeURIComponent(userId)}/summary`, correlationId);
        if (res.status === 200) return (res.body as { data: UserSummary }).data;
        if (res.status !== 404) logger.warn({ userId, status: res.status, correlationId }, 'User summary failed');
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message, correlationId }, 'User summary failed');
      }
      return null;
    },
  };
}
