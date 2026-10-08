import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemorySupplierRepository } from '../../src/db/repository.js';
import { TEST_IMAGES_DIR } from './helpers.js';

describe('Slice 7: Admin Mutations', () => {
  let app: FastifyInstance;
  let privateKey: any;
  let repository: InMemorySupplierRepository;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const jwk = await exportJWK(keyPair.publicKey);
    jwk.kid = 'admin-key';
    jwk.alg = 'RS256';

    repository = new InMemorySupplierRepository();

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

  async function createToken(roles: string[] = ['admin']) {
    return new SignJWT({
      sub: 'admin-id',
      realm_access: { roles },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'admin-key' })
      .setIssuer('http://localhost:8080/realms/campuserrand')
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  it('rejects POST /v1/suppliers from non-admin with 403 INSUFFICIENT_ROLE', async () => {
    const token = await createToken(['user']);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Forbidden Cafe',
        facilityType: 'Food',
        building: 'Com 2',
        opensAt: '09:00',
        closesAt: '18:00',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: 'INSUFFICIENT_ROLE' },
    });
  });

  it('strictly rejects POST /v1/suppliers with "tags" with 422 VALIDATION_ERROR', async () => {
    const token = await createToken(['admin']);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Cool Cafe',
        facilityType: 'Food',
        building: 'Com 2',
        opensAt: '09:00',
        closesAt: '18:00',
        tags: ['drinks', 'coffee'],
      },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.fieldErrors.tags).toBeDefined();
    expect(body.error.details.fieldErrors.tags[0]).toMatch(/This field is not allowed/i);
  });

  let createdSupplierId: string;

  it('admin creates new supplier successfully returning 201', async () => {
    const token = await createToken(['admin']);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Techno Edge Noodle',
        facilityType: 'Food',
        building: 'Techno Edge',
        floor: '1',
        locationDescription: 'Stall 4',
        latitude: 1.297,
        longitude: 103.771,
        opensAt: '08:00',
        closesAt: '20:00',
        imageUrl: 'https://example.com/techno.jpeg',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.name).toBe('Techno Edge Noodle');
    expect(body.data.isActive).toBe(true);
    expect(body.data).not.toHaveProperty('tags');
    createdSupplierId = body.data.id;
  });

  it('rejects duplicate supplier name with 409 SUPPLIER_NAME_TAKEN', async () => {
    const token = await createToken(['admin']);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'techno edge noodle', // same name, different casing
        facilityType: 'Food',
        building: 'Com 1',
        opensAt: '09:00',
        closesAt: '18:00',
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: { code: 'SUPPLIER_NAME_TAKEN' },
    });
  });

  it('admin updates supplier details via PATCH /v1/suppliers/:id', async () => {
    const token = await createToken(['admin']);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/suppliers/${createdSupplierId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        locationDescription: 'Relocated next to drink stall',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.locationDescription).toBe('Relocated next to drink stall');
  });

  it('admin deactivates supplier via PATCH /v1/suppliers/:id/deactivate', async () => {
    const token = await createToken(['admin']);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/suppliers/${createdSupplierId}/deactivate`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.isActive).toBe(false);
  });

  it('admin reactivates supplier via PATCH /v1/suppliers/:id/reactivate', async () => {
    const token = await createToken(['admin']);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/suppliers/${createdSupplierId}/reactivate`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.isActive).toBe(true);
  });

  it('admin deletes single supplier via DELETE /v1/suppliers/:id returning 204', async () => {
    const token = await createToken(['admin']);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/suppliers/${createdSupplierId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
  });

  it('admin bulk deletes suppliers by facilityType with confirm=true', async () => {
    const token = await createToken(['admin']);

    // Create 2 test stalls
    await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Bulk Print 1',
        facilityType: 'Printing',
        building: 'Com 1',
        opensAt: '09:00',
        closesAt: '18:00',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Bulk Print 2',
        facilityType: 'Printing',
        building: 'Com 2',
        opensAt: '09:00',
        closesAt: '18:00',
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/suppliers?facilityType=Printing&confirm=true',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: {
        deleted: 2,
        facilityType: 'Printing',
      },
    });
  });
});
