import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';

/** Never log credentials or tokens (F1.2.2). */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-internal-auth"]',
  'req.headers.cookie',
  'password',
  'confirmPassword',
  'token',
  'accessToken',
  '*.password',
  '*.confirmPassword',
  '*.token',
  '*.accessToken',
  '*.client_secret',
];

export function createLogger(service: string, level = process.env.LOG_LEVEL || 'info'): Logger {
  return pino({ name: service, level, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } });
}

export const CORRELATION_HEADER = 'x-correlation-id';

/** Reuses an incoming X-Correlation-Id or creates one, and echoes it on the response (F36.3). */
export const correlationId: RequestHandler = (req, res, next) => {
  const incoming = req.header(CORRELATION_HEADER);
  const id = incoming && /^[\w-]{8,100}$/.test(incoming) ? incoming : randomUUID();
  req.correlationId = id;
  res.setHeader('X-Correlation-Id', id);
  next();
};

export function httpLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req) => (req as { correlationId?: string }).correlationId ?? randomUUID(),
    autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }) as RequestHandler;
}
