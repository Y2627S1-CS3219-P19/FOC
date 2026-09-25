import type { ZodIssue, ZodTypeAny, output } from 'zod';
import { unprocessable } from './errors.js';

/** Turns zod issues into { field: message }. Unknown keys (from .strict()) are reported per key. */
export function toFieldErrors(issues: ZodIssue[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fieldErrors[key] = 'This field is not allowed.';
      continue;
    }
    const key = issue.path.length ? issue.path.join('.') : '_root';
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

/** Parse input with a zod schema or throw a 422 VALIDATION_ERROR with per-field messages. */
export function parseOrThrow<S extends ZodTypeAny>(schema: S, data: unknown, message = 'Some fields are invalid.'): output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw unprocessable(message, toFieldErrors(result.error.issues));
  return result.data;
}
