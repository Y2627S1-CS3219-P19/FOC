import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemorySupplierRepository } from '../../src/db/repository.js';

const TEST_SECRET = 'test-secret-12345';
const NON_EXISTENT_UUID = '00000000-0000-0000-0000-000000000000';
const INACTIVE_UUID = '11111111-1111-1111-1111-111111111111';
const CLOSED_UUID = '22222222-2222-2222-2222-222222222222';
const OPEN_ACTIVE_UUID = '33333333-3333-3333-3333-333333333333';

describe('Seam: GET /v1/internal/suppliers/:id/validate', () => {
  let app: FastifyInstance;
  let repo: InMemorySupplierRepository;

  beforeEach(async () => {
    repo = new InMemorySupplierRepository([
      {
        id: INACTIVE_UUID,
        name: 'Deactivated Stall',
        facilityType: 'Food',
        building: 'Com 2',
        floor: '1',
        locationDescription: 'Renovating',
        latitude: null,
        longitude: null,
        opensAt: '00:00',
        closesAt: '23:59',
        isActive: false,
        imageUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: CLOSED_UUID,
        name: 'Night Only Stall',
        facilityType: 'Food',
        building: 'UTown',
        floor: '2',
        locationDescription: 'Late supper',
        latitude: null,
        longitude: null,
        opensAt: '03:00',
        closesAt: '04:00', // Definitely closed during normal daytime / midnight
        isActive: true,
        imageUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: OPEN_ACTIVE_UUID,
        name: '24-7 Minimart',
        facilityType: 'Convenience',
        building: 'Science',
        floor: 'B1',
        locationDescription: 'Block S16',
        latitude: 1.295,
        longitude: 103.776,
        opensAt: '00:00',
        closesAt: '23:59', // Always open
        isActive: true,
        imageUrl: 'https://example.com/minimart.jpg',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    app = await buildApp({
      repository: repo,
      authConfig: {
        internalAuthSecret: TEST_SECRET,
      },
    });
    await app.ready();
  });

  describe('Slice 1: Internal Auth & Security Boundary', () => {
    it('returns 401 INTERNAL_AUTH_REQUIRED when X-Internal-Auth header is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/internal/suppliers/${OPEN_ACTIVE_UUID}/validate`,
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.error?.code).toBe('INTERNAL_AUTH_REQUIRED');
    });

    it('returns 401 INTERNAL_AUTH_REQUIRED when X-Internal-Auth header is invalid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/internal/suppliers/${OPEN_ACTIVE_UUID}/validate`,
        headers: {
          'x-internal-auth': 'wrong-secret',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.error?.code).toBe('INTERNAL_AUTH_REQUIRED');
    });

    it('returns 403 USER_TOKEN_NOT_ALLOWED when request carries a user Authorization header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/internal/suppliers/${OPEN_ACTIVE_UUID}/validate`,
        headers: {
          'x-internal-auth': TEST_SECRET,
          authorization: 'Bearer user-access-token',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.error?.code).toBe('USER_TOKEN_NOT_ALLOWED');
    });
  });

  describe('Slice 2: Parameter Validation Boundary', () => {
    it('returns 422 VALIDATION_ERROR when :id is not a valid UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/internal/suppliers/not-a-valid-uuid/validate',
        headers: {
          'x-internal-auth': TEST_SECRET,
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Slice 3: Validation Verdict Behavior', () => {
    it('returns exists=false and reason=NOT_FOUND for non-existent supplier', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/internal/suppliers/${NON_EXISTENT_UUID}/validate`,
        headers: {
          'x-internal-auth': TEST_SECRET,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toEqual({
        exists: false,
        isActive: false,
        isOpenNow: false,
        valid: false,
        reason: 'NOT_FOUND',
        supplier: null,
      });
    });

    it('returns isActive=false and reason=INACTIVE for deactivated supplier', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/internal/suppliers/${INACTIVE_UUID}/validate`,
        headers: {
          'x-internal-auth': TEST_SECRET,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.exists).toBe(true);
      expect(body.data.isActive).toBe(false);
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('INACTIVE');
      expect(body.data.supplier?.name).toBe('Deactivated Stall');
    });

    it('returns isOpenNow=false and reason=CLOSED for closed supplier', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/internal/suppliers/${CLOSED_UUID}/validate`,
        headers: {
          'x-internal-auth': TEST_SECRET,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.exists).toBe(true);
      expect(body.data.isActive).toBe(true);
      expect(body.data.isOpenNow).toBe(false);
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('CLOSED');
      expect(body.data.supplier?.name).toBe('Night Only Stall');
    });

    it('returns valid=true and reason=null for active, open supplier with snapshot fields', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/internal/suppliers/${OPEN_ACTIVE_UUID}/validate`,
        headers: {
          'x-internal-auth': TEST_SECRET,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toEqual({
        exists: true,
        isActive: true,
        isOpenNow: true,
        valid: true,
        reason: null,
        supplier: {
          id: OPEN_ACTIVE_UUID,
          name: '24-7 Minimart',
          facilityType: 'Convenience',
          building: 'Science',
          floor: 'B1',
          locationDescription: 'Block S16',
          opensAt: '00:00',
          closesAt: '23:59',
        },
      });
    });
  });
});
