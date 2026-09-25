import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';

/**
 * Every non-2xx response from every FoC service uses this envelope:
 *   { "error": { "code": "STRING_CODE", "message": "human readable", "details": {...} } }
 * 401 = not authenticated (missing/invalid/expired/revoked token), 403 = authenticated but not allowed (F6.6).
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (code = 'UNAUTHENTICATED', message = 'Authentication required.') =>
  new AppError(401, code, message);
export const forbidden = (
  code = 'FORBIDDEN',
  message = 'You do not have permission to perform this action.',
  details?: unknown,
) => new AppError(403, code, message, details);
export const notFound = (code = 'NOT_FOUND', message = 'Resource not found.') => new AppError(404, code, message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const unprocessable = (message: string, fieldErrors: Record<string, string>) =>
  new AppError(422, 'VALIDATION_ERROR', message, { fieldErrors });
export const serviceUnavailable = (code: string, message: string) => new AppError(503, code, message);

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound('ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      if (err.status >= 500) logger.error({ err, correlationId: req.correlationId }, err.message);
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    // Malformed JSON body from express.json()
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
      return;
    }
    logger.error({ err, correlationId: req.correlationId }, 'Unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
  };
}
