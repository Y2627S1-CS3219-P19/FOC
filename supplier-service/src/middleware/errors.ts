import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function unauthorized(code: string, message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError(401, code, message, details);
}

export function forbidden(code: string, message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError(403, code, message, details);
}

export function notFound(code: string, message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError(404, code, message, details);
}

export function conflict(code: string, message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError(409, code, message, details);
}

export function validationError(details: Record<string, unknown>): AppError {
  return new AppError(422, 'VALIDATION_ERROR', 'Invalid input', details);
}

export function serviceUnavailable(code: string, message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError(503, code, message, details);
}

export function errorHandler(error: FastifyError | AppError | Error, _req: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  if (error instanceof ZodError) {
    const fieldErrors = error.flatten().fieldErrors;
    return reply.status(422).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { fieldErrors },
      },
    });
  }

  // Fastify schema validation error fallback
  if ('validation' in error && error.validation) {
    return reply.status(422).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message || 'Invalid input',
        details: { fieldErrors: error.validation },
      },
    });
  }

  const statusCode = (error as any).statusCode || 500;
  return reply.status(statusCode).send({
    error: {
      code: (error as any).code || 'INTERNAL_SERVER_ERROR',
      message: error.message || 'An unexpected error occurred',
      details: {},
    },
  });
}
