import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError, createLogger } from '@foc/shared-middleware';
import { createSupplierClient } from '../src/clients/supplierClient.js';
import { createUserClient } from '../src/clients/userClient.js';

// A real HTTP server standing in for Supplier and User services, so timeouts, status codes and headers are real.
const SECRET = 'test-secret-123';
const SUPPLIER_ID = '5a5a5a5a-0000-0000-0000-000000000001';
const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

let server: Server;
let baseUrl: string;
let reply: { status: number; body?: unknown; delayMs?: number };
let lastHeaders: IncomingHttpHeaders;
let lastPath: string | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    lastHeaders = req.headers;
    lastPath = req.url;
    setTimeout(() => {
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
    }, reply.delayMs ?? 0);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  reply = { status: 200 };
});

const logger = createLogger('clients-test', 'silent');
const supplierClient = () => createSupplierClient({ baseUrl, secret: SECRET, timeoutMs: 200 });
const userClient = () => createUserClient({ baseUrl, secret: SECRET, timeoutMs: 200 }, logger);

const supplier = {
  id: SUPPLIER_ID,
  name: 'Cool Spot',
  facilityType: 'Food',
  building: 'Com2',
  floor: '1',
  locationDescription: 'Opp LT16',
  opensAt: '09:00',
  closesAt: '21:30',
};
// What the client keeps for the order snapshot (opening hours are not stored on the order).
const snapshot = {
  id: supplier.id,
  name: supplier.name,
  facilityType: supplier.facilityType,
  building: supplier.building,
  floor: supplier.floor,
  locationDescription: supplier.locationDescription,
};

const validateBody = (valid: boolean, reason: string | null, withSupplier = true) => ({
  data: {
    exists: reason !== 'NOT_FOUND',
    isActive: reason !== 'INACTIVE',
    isOpenNow: valid,
    valid,
    reason,
    supplier: withSupplier ? supplier : null,
  },
});

/** Runs fn and returns the AppError it throws (fails the test if it does not throw one). */
async function appErrorOf(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected an AppError');
}

describe('supplier client', () => {
  it('calls the internal validate route with the service secret and correlation id', async () => {
    reply = { status: 200, body: validateBody(true, null) };
    const result = await supplierClient().validate(SUPPLIER_ID, 'corr-abc-123');
    expect(lastPath).toBe(`/v1/internal/suppliers/${SUPPLIER_ID}/validate`);
    expect(lastHeaders['x-internal-auth']).toBe(SECRET);
    expect(lastHeaders['x-correlation-id']).toBe('corr-abc-123');
    expect(lastHeaders.authorization).toBeUndefined();
    expect(result).toEqual({ valid: true, supplier: snapshot });
  });

  it('turns an empty location description into an empty string, so the order can be saved', async () => {
    reply = {
      status: 200,
      body: { data: { ...validateBody(true, null).data, supplier: { ...supplier, locationDescription: null } } },
    };
    const result = await supplierClient().validate(SUPPLIER_ID);
    expect(result).toEqual({ valid: true, supplier: { ...snapshot, locationDescription: '' } });
  });

  it.each([
    ['NOT_FOUND', false],
    ['INACTIVE', true],
    ['CLOSED', true],
  ])('maps %s to an invalid result', async (reason, withSupplier) => {
    reply = { status: 200, body: validateBody(false, reason, withSupplier) };
    expect(await supplierClient().validate(SUPPLIER_ID)).toEqual({ valid: false, reason });
  });

  it('503 SUPPLIER_UNAVAILABLE on a 5xx', async () => {
    reply = { status: 500, body: { error: { code: 'INTERNAL_ERROR' } } };
    const err = await appErrorOf(() => supplierClient().validate(SUPPLIER_ID));
    expect(err.status).toBe(503);
    expect(err.code).toBe('SUPPLIER_UNAVAILABLE');
  });

  it('503 SUPPLIER_UNAVAILABLE when it is too slow', async () => {
    reply = { status: 200, body: validateBody(true, null), delayMs: 500 };
    const started = Date.now();
    const err = await appErrorOf(() => supplierClient().validate(SUPPLIER_ID));
    expect(err.code).toBe('SUPPLIER_UNAVAILABLE');
    expect(Date.now() - started).toBeLessThan(450);
  });

  it('503 SUPPLIER_UNAVAILABLE when nothing is listening', async () => {
    const client = createSupplierClient({ baseUrl: 'http://127.0.0.1:1', secret: SECRET, timeoutMs: 200 });
    expect((await appErrorOf(() => client.validate(SUPPLIER_ID))).code).toBe('SUPPLIER_UNAVAILABLE');
  });

  it('a 4xx (e.g. wrong secret) is a plain error, so it shows up as a 500 and in the logs', async () => {
    reply = { status: 401, body: { error: { code: 'INTERNAL_AUTH_REQUIRED' } } };
    await expect(supplierClient().validate(SUPPLIER_ID)).rejects.toThrow('Supplier validate returned 401');
  });
});

describe('user client', () => {
  it('returns the summary from the internal route', async () => {
    reply = { status: 200, body: { data: { id: USER_ID, displayName: 'Alice Tan', rating: 4.5 } } };
    expect(await userClient().summary(USER_ID, 'corr-abc-123')).toEqual({ id: USER_ID, displayName: 'Alice Tan', rating: 4.5 });
    expect(lastPath).toBe(`/v1/internal/users/${USER_ID}/summary`);
    expect(lastHeaders['x-internal-auth']).toBe(SECRET);
    expect(lastHeaders['x-correlation-id']).toBe('corr-abc-123');
  });

  it.each([
    ['404', { status: 404, body: { error: { code: 'USER_NOT_FOUND' } } }],
    ['500', { status: 500 }],
    ['timeout', { status: 200, body: { data: {} }, delayMs: 500 }],
  ])('returns null instead of failing on %s', async (_name, r) => {
    reply = r;
    expect(await userClient().summary(USER_ID)).toBeNull();
  });
});
