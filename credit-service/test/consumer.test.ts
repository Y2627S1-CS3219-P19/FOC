import { describe, expect, it } from 'vitest';
import { parseEnvelope } from '@foc/shared-events';
import { afterFailure, MAX_ATTEMPTS } from '../src/consumer.js';

const envelope = (type: string, payload: unknown) =>
  JSON.stringify({
    eventId: '6f1c2c1e-1111-4a4a-9b9b-000000000001',
    type,
    version: 1,
    occurredAt: '2026-10-20T00:00:00.000Z',
    correlationId: null,
    payload,
  });

describe('parseEnvelope', () => {
  it('accepts a valid OrderCreated and keeps extra payload fields', () => {
    const r = parseEnvelope(envelope('OrderCreated', { orderId: 'o1', requesterId: 'u1', creditAmount: 5, orderVersion: 1 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope.payload).toMatchObject({ orderId: 'o1', orderVersion: 1 });
  });

  it('rejects bad JSON', () => {
    expect(parseEnvelope('{not json')).toEqual({ ok: false, error: 'Message is not valid JSON' });
  });

  it('rejects an envelope without eventId', () => {
    const r = parseEnvelope(JSON.stringify({ type: 'OrderCreated', version: 1, occurredAt: 'x', correlationId: null, payload: {} }));
    expect(r.ok).toBe(false);
  });

  it('rejects a payload with a missing or wrongly typed field and reports the event id', () => {
    const missing = parseEnvelope(envelope('OrderCreated', { requesterId: 'u1', creditAmount: 5 }));
    expect(missing).toMatchObject({ ok: false, eventId: '6f1c2c1e-1111-4a4a-9b9b-000000000001' });
    const wrongType = parseEnvelope(envelope('OrderCompleted', { orderId: 'o1', requesterId: 'u1', runnerId: 'u2', creditAmount: '5' }));
    expect(wrongType.ok).toBe(false);
  });

  it('passes unknown event types with a valid envelope (the consumer decides)', () => {
    expect(parseEnvelope(envelope('SomethingNew', { anything: true })).ok).toBe(true);
  });
});

describe('afterFailure', () => {
  it('retries until MAX_ATTEMPTS, then dead-letters', () => {
    expect(afterFailure(0)).toEqual({ attempt: 1, deadLetter: false });
    expect(afterFailure(MAX_ATTEMPTS - 2)).toEqual({ attempt: MAX_ATTEMPTS - 1, deadLetter: false });
    expect(afterFailure(MAX_ATTEMPTS - 1)).toEqual({ attempt: MAX_ATTEMPTS, deadLetter: true });
  });
});
