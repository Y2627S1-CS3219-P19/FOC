import { useCallback } from 'react';
import { useAuth } from './auth';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { fieldErrors?: Record<string, string>; [key: string]: unknown },
  ) {
    super(message);
  }
  get fieldErrors(): Record<string, string> {
    return this.details?.fieldErrors ?? {};
  }
}

export interface Page<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function apiRequest<T>(method: Method, path: string, options: { body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: ApiError['details'] } }).error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return json as T;
}

/** API calls with the current access token. A revoked/expired session clears local tokens so the UI shows "log in". */
export function useApi() {
  const { accessToken, forget } = useAuth();
  return useCallback(
    async <T,>(method: Method, path: string, body?: unknown): Promise<T> => {
      try {
        return await apiRequest<T>(method, path, { body, token: accessToken });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && accessToken) await forget();
        throw err;
      }
    },
    [accessToken, forget],
  );
}
