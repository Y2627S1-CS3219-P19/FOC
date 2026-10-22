import { z } from 'zod';
import { CREDIT_EVENTS, ORDER_EVENTS, USER_EVENTS, type EventEnvelope } from './events.js';

/**
 * Runtime checks for consumed events, mirroring the payload types in events.ts.
 * Consumers call parseEnvelope() first, so a malformed message is dead-lettered instead of reaching
 * handler code. Extra fields are allowed and kept (e.g. orderVersion), so producers can add fields
 * without breaking consumers.
 */
const id = z.string().min(1);
const role = z.enum(['user', 'admin']);
const amount = z.number().int().nonnegative();

export const eventEnvelopeSchema = z.object({
  eventId: id,
  type: z.string().min(1),
  version: z.number().int().positive(),
  occurredAt: z.string().min(1),
  correlationId: z.string().nullable(),
  // z.unknown() would also accept a missing payload.
  payload: z.unknown().refine((v) => v !== undefined, 'Required'),
});

export const EVENT_PAYLOAD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [USER_EVENTS.registered.type]: z.object({ userId: id, username: z.string().min(1), role, registeredAt: z.string() }),
  [USER_EVENTS.suspended.type]: z.object({ userId: id, suspendedBy: id, reason: z.string() }),
  [USER_EVENTS.reinstated.type]: z.object({ userId: id, reinstatedBy: id }),
  [USER_EVENTS.roleChanged.type]: z.object({ userId: id, oldRole: role, newRole: role, requestedBy: id, approvedBy: id }),

  [ORDER_EVENTS.created.type]: z.object({ orderId: id, requesterId: id, creditAmount: amount }),
  [ORDER_EVENTS.completed.type]: z.object({ orderId: id, requesterId: id, runnerId: id, creditAmount: amount }),
  [ORDER_EVENTS.withdrawn.type]: z.object({ orderId: id }),
  [ORDER_EVENTS.cancelled.type]: z.object({ orderId: id, cancelledBy: id }),
  [ORDER_EVENTS.expired.type]: z.object({ orderId: id }),

  [CREDIT_EVENTS.walletCreated.type]: z.object({ userId: id, initialBalance: amount }),
  [CREDIT_EVENTS.reserved.type]: z.object({ orderId: id, requesterId: id, amount }),
  [CREDIT_EVENTS.reservationFailed.type]: z.object({
    orderId: id,
    requesterId: id,
    amount,
    availableBalance: z.number().int().nullable(),
    reason: z.enum(['INSUFFICIENT_CREDITS', 'NO_WALLET']),
  }),
  [CREDIT_EVENTS.returned.type]: z.object({ orderId: id, requesterId: id, amount, reason: z.string() }),
  [CREDIT_EVENTS.released.type]: z.object({ orderId: id, requesterId: id, runnerId: id, amount }),
};

export type ParsedEnvelope = { ok: true; envelope: EventEnvelope } | { ok: false; error: string; eventId?: string };

const describe = (issues: z.ZodIssue[]) =>
  issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');

/** Parses a raw message body. Types without a schema only get the envelope check (the consumer decides). */
export function parseEnvelope(raw: string): ParsedEnvelope {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Message is not valid JSON' };
  }
  const envelope = eventEnvelopeSchema.safeParse(json);
  if (!envelope.success) return { ok: false, error: `Invalid envelope: ${describe(envelope.error.issues)}` };

  const schema = EVENT_PAYLOAD_SCHEMAS[envelope.data.type];
  // Cast: zod types an unknown() key as optional; the refine above guarantees it is present.
  const valid = envelope.data as EventEnvelope;
  if (!schema) return { ok: true, envelope: valid };
  const payload = schema.safeParse(envelope.data.payload);
  if (!payload.success) {
    return {
      ok: false,
      error: `Invalid ${envelope.data.type} payload: ${describe(payload.error.issues)}`,
      eventId: envelope.data.eventId,
    };
  }
  return { ok: true, envelope: valid };
}
