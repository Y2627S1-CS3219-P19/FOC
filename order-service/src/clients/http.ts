import { CORRELATION_HEADER, INTERNAL_AUTH_HEADER, serviceUnavailable } from '@foc/shared-middleware';

export interface InternalHttpOptions {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
  /** Used in the 503 code, e.g. SUPPLIER -> SUPPLIER_UNAVAILABLE. */
  service: 'SUPPLIER' | 'USER';
}

export interface InternalResponse {
  status: number;
  body: unknown;
}

/**
 * Calls a /v1/internal route of another service. Timeouts, network errors and 5xx become 503
 * <SERVICE>_UNAVAILABLE. Every other status is returned for the caller to handle.
 */
export async function callInternal(
  options: InternalHttpOptions,
  method: 'GET' | 'POST',
  path: string,
  correlationId: string | undefined,
  body?: unknown,
): Promise<InternalResponse> {
  const unavailable = () =>
    serviceUnavailable(`${options.service}_UNAVAILABLE`, `The ${options.service.toLowerCase()} service is not responding. Please try again.`);
  let res: Response;
  try {
    res = await fetch(`${options.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_AUTH_HEADER]: options.secret,
        ...(correlationId ? { [CORRELATION_HEADER]: correlationId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch {
    throw unavailable();
  }
  if (res.status >= 500) throw unavailable();
  return { status: res.status, body: await res.json().catch(() => null) };
}
