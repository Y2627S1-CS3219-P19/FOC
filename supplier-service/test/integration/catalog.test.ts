import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemorySupplierRepository } from '../../src/db/repository.js';
import { TEST_IMAGES_DIR } from './helpers.js';

describe('Slice 6: Catalog Querying', () => {
  let app: FastifyInstance;
  let privateKey: any;
  let repository: InMemorySupplierRepository;

  const mockSuppliers = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Cool Spot',
      facilityType: 'Food',
      building: 'Com 2',
      floor: '1',
      locationDescription: 'Opp LT16',
      latitude: 1.2940156,
      longitude: 103.7738478,
      opensAt: '09:00',
      closesAt: '21:30',
      isActive: true,
      imageUrl: '/v1/supplier-images/COOL_SPOT.jpeg',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'NUS Co-op',
      facilityType: 'Shopping',
      building: 'Central Library',
      floor: '1',
      locationDescription: 'Inside library',
      latitude: 1.2967866,
      longitude: 103.7732677,
      opensAt: '09:00',
      closesAt: '16:00',
      isActive: true,
      imageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Old Closed Cafe',
      facilityType: 'Food',
      building: 'Com 2',
      floor: '2',
      locationDescription: 'Under renovation',
      latitude: null,
      longitude: null,
      opensAt: '08:00',
      closesAt: '18:00',
      isActive: false, // Deactivated!
      imageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const jwk = await exportJWK(keyPair.publicKey);
    jwk.kid = 'catalog-key';
    jwk.alg = 'RS256';

    repository = new InMemorySupplierRepository(mockSuppliers);

    app = await buildApp({
      imagesDir: TEST_IMAGES_DIR,
      repository,
      authConfig: {
        getJwksKeys: async () => [jwk],
        introspectFn: async () => ({ status: 200, body: { active: true } }),
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createToken(roles: string[] = ['user']) {
    return new SignJWT({
      sub: 'student-id',
      realm_access: { roles },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'catalog-key' })
      .setIssuer('http://localhost:8080/realms/campuserrand')
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  it('GET /v1/suppliers returns paginated envelope with camelCase fields', async () => {
    const token = await createToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/suppliers',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('page', 1);
    expect(body).toHaveProperty('limit', 20);
    expect(body).toHaveProperty('total', 2); // Only active ones for regular student!
    expect(res.headers['x-correlation-id']).toBeDefined();

    const first = body.data[0];
    expect(first).toHaveProperty('facilityType');
    expect(first).toHaveProperty('isOpenNow');
    expect(first).toHaveProperty('isActive', true);
    expect(first).not.toHaveProperty('tags');
  });

  it('regular student querying ?status=inactive receives 403 ADMIN_ONLY_FILTER', async () => {
    const token = await createToken(['user']);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/suppliers?status=inactive',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: 'ADMIN_ONLY_FILTER' },
    });
  });

  it('admin can query ?status=inactive and receives deactivated stalls', async () => {
    const token = await createToken(['admin']);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/suppliers?status=inactive',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0].name).toBe('Old Closed Cafe');
    expect(body.data[0].isActive).toBe(false);
  });

  it('filters by keyword search (case-insensitive substring in name, building, description)', async () => {
    const token = await createToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/suppliers?search=cool',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('Cool Spot');
  });

  it('filters by facilityType', async () => {
    const token = await createToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/suppliers?facilityType=Shopping',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('NUS Co-op');
  });

  it('filters by building', async () => {
    const token = await createToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/suppliers?building=Central Library',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('NUS Co-op');
  });

  it('GET /v1/suppliers/filter-options returns distinct facilityTypes and buildings', async () => {
    const token = await createToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/suppliers/filter-options',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: {
        facilityTypes: ['Food', 'Shopping'],
        buildings: ['Central Library', 'Com 2'],
      },
    });
  });

  it('GET /v1/suppliers/:id returns full details for active supplier', async () => {
    const token = await createToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/suppliers/11111111-1111-1111-1111-111111111111',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe('Cool Spot');
  });

  it('GET /v1/suppliers/:id returns 404 for deactivated supplier when requested by regular user', async () => {
    const token = await createToken(['user']);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/suppliers/33333333-3333-3333-3333-333333333333',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: 'SUPPLIER_NOT_FOUND' },
    });
  });

  it('GET /v1/suppliers/:id returns 200 for deactivated supplier when requested by admin', async () => {
    const token = await createToken(['admin']);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/suppliers/33333333-3333-3333-3333-333333333333',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe('Old Closed Cafe');
  });
});
