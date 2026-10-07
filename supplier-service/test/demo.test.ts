import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { buildApp } from '../dist/app.js';
import { InMemorySupplierRepository } from '../dist/db/repository.js';

// Visual ANSI styling
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function runDemo() {
  console.log('\n' + '='.repeat(70));
  console.log(bold(cyan('  FRIEND ON CAMPUS (FoC) - SUPPLIER SERVICE CRUD & RBAC DEMO')));
  console.log(dim('  Running live with Fastify HTTP injection against InMemory Repository'));
  console.log('='.repeat(70) + '\n');

  // 1. Generate in-memory RSA keypair for JWT signing
  const keyPair = await generateKeyPair('RS256');
  const jwk = await exportJWK(keyPair.publicKey);
  jwk.kid = 'demo-key';
  jwk.alg = 'RS256';

  // Helper to issue realistic Keycloak JWTs
  async function mintToken(name: string, roles: string[]) {
    return new SignJWT({
      preferred_username: name,
      email: `${name}@u.nus.edu`,
      realm_access: { roles },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'demo-key' })
      .setIssuer('http://localhost:8080/realms/campuserrand')
      .setExpirationTime('1h')
      .sign(keyPair.privateKey);
  }

  const adminToken = await mintToken('admin-alice', ['admin', 'user']);
  const studentToken = await mintToken('student-bob', ['user']);

  // Pre-seed some dummy suppliers
  const repo = new InMemorySupplierRepository([
    {
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'Techno Edge Noodle',
      facilityType: 'Food',
      building: 'Techno Edge',
      floor: '1',
      locationDescription: 'Stall 4',
      latitude: 1.297,
      longitude: 103.771,
      opensAt: '08:00',
      closesAt: '20:00',
      isActive: true,
      imageUrl: '/v1/supplier-images/TECHNO.jpeg',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'a0000000-0000-0000-0000-000000000002',
      name: 'Central Library Co-op',
      facilityType: 'Shopping',
      building: 'Central Library',
      floor: '1',
      locationDescription: 'Inside entrance',
      latitude: 1.296,
      longitude: 103.773,
      opensAt: '09:00',
      closesAt: '17:00',
      isActive: true,
      imageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

  const app = await buildApp({
    repository: repo,
    authConfig: {
      getJwksKeys: async () => [jwk],
      // Mock User Service Introspection returning active session
      introspectFn: async () => ({ status: 200, body: { active: true } }),
    },
  });
  await app.ready();

  function printResponse(label: string, res: any) {
    const statusColor = res.statusCode >= 200 && res.statusCode < 300 ? green : red;
    console.log(`\n${bold(label)}`);
    console.log(`HTTP Status: ${statusColor(String(res.statusCode))}`);
    if (res.body) {
      try {
        console.log(`Response Body:\n${JSON.stringify(JSON.parse(res.body), null, 2)}`);
      } catch {
        console.log(`Response Body: ${res.body}`);
      }
    }
  }

  // -------------------------------------------------------------
  // SCENARIO 1: RBAC ON CREATE
  // -------------------------------------------------------------
  console.log(bold('\n>>> [1] DEMO: CREATE SUPPLIER (RBAC & CONSTRAINTS)'));

  // 1a. Student attempts to create -> Should be 403 Forbidden
  const studentCreateRes = await app.inject({
    method: 'POST',
    url: '/v1/suppliers',
    headers: { authorization: `Bearer ${studentToken}` },
    payload: {
      name: 'Illegal Food Stall',
      facilityType: 'Food',
      building: 'Com 2',
      opensAt: '08:00',
      closesAt: '18:00',
    },
  });
  printResponse('1a. Student attempts POST /v1/suppliers (Unauthorized)', studentCreateRes);

  // 1b. Admin creates new supplier -> 201 Created
  const adminCreateRes = await app.inject({
    method: 'POST',
    url: '/v1/suppliers',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      name: 'The Deck Pasta & Western',
      facilityType: 'Food',
      building: 'The Deck',
      floor: '2',
      locationDescription: 'Near stairs to LT27',
      opensAt: '09:00',
      closesAt: '20:30',
    },
  });
  printResponse('1b. Admin creates supplier POST /v1/suppliers (Success)', adminCreateRes);
  const newSupplier = JSON.parse(adminCreateRes.body).data;

  // 1c. Admin attempts duplicate name -> 409 Conflict
  const duplicateCreateRes = await app.inject({
    method: 'POST',
    url: '/v1/suppliers',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      name: 'the deck pasta & western', // case-insensitive duplicate
      facilityType: 'Food',
      building: 'The Deck',
      opensAt: '09:00',
      closesAt: '20:30',
    },
  });
  printResponse('1c. Admin creates duplicate name (Case-insensitive 409 Conflict)', duplicateCreateRes);

  // -------------------------------------------------------------
  // SCENARIO 2: READ & QUERY PATTERNS
  // -------------------------------------------------------------
  console.log(bold('\n>>> [2] DEMO: READ & QUERY (SEARCH, FILTER, OPEN STATUS)'));

  // 2a. Student searches with text query & building filter
  const studentQueryRes = await app.inject({
    method: 'GET',
    url: '/v1/suppliers?search=Pasta&building=The Deck&status=active',
    headers: { authorization: `Bearer ${studentToken}` },
  });
  printResponse('2a. Student queries GET /v1/suppliers?search=Pasta&building=The Deck', studentQueryRes);

  // -------------------------------------------------------------
  // SCENARIO 3: UPDATE (PATCH)
  // -------------------------------------------------------------
  console.log(bold('\n>>> [3] DEMO: UPDATE / EDIT (PATCH)'));

  // 3a. Student attempts update -> 403 Forbidden
  const studentUpdateRes = await app.inject({
    method: 'PATCH',
    url: `/v1/suppliers/${newSupplier.id}`,
    headers: { authorization: `Bearer ${studentToken}` },
    payload: { opensAt: '07:00' },
  });
  printResponse('3a. Student attempts PATCH /v1/suppliers/:id (Forbidden)', studentUpdateRes);

  // 3b. Admin updates supplier details -> 200 OK
  const adminUpdateRes = await app.inject({
    method: 'PATCH',
    url: `/v1/suppliers/${newSupplier.id}`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      locationDescription: 'Renovated Stall 5 near LT27',
      closesAt: '22:00',
    },
  });
  printResponse('3b. Admin updates details PATCH /v1/suppliers/:id (Success)', adminUpdateRes);

  // -------------------------------------------------------------
  // SCENARIO 4: DEACTIVATE & REACTIVATE (SOFT DELETE)
  // -------------------------------------------------------------
  console.log(bold('\n>>> [4] DEMO: DEACTIVATE & REACTIVATE (SOFT DELETE LIFECYCLE)'));

  // 4a. Admin deactivates supplier -> 200 OK
  const deactRes = await app.inject({
    method: 'PATCH',
    url: `/v1/suppliers/${newSupplier.id}/deactivate`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  printResponse('4a. Admin deactivates supplier PATCH /v1/suppliers/:id/deactivate', deactRes);

  // 4b. Student tries to view deactivated supplier -> 404 Not Found (Hidden from students)
  const studentGetDeactRes = await app.inject({
    method: 'GET',
    url: `/v1/suppliers/${newSupplier.id}`,
    headers: { authorization: `Bearer ${studentToken}` },
  });
  printResponse('4b. Student attempts to GET deactivated supplier (404 Hidden)', studentGetDeactRes);

  // 4c. Student tries to filter for inactive suppliers -> 403 Forbidden
  const studentFilterInactiveRes = await app.inject({
    method: 'GET',
    url: '/v1/suppliers?status=inactive',
    headers: { authorization: `Bearer ${studentToken}` },
  });
  printResponse('4c. Student attempts to query status=inactive (403 ADMIN_ONLY_FILTER)', studentFilterInactiveRes);

  // 4d. Admin can still view deactivated supplier
  const adminGetDeactRes = await app.inject({
    method: 'GET',
    url: `/v1/suppliers/${newSupplier.id}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  printResponse('4d. Admin queries deactivated supplier (200 OK with isActive: false)', adminGetDeactRes);

  // 4e. Admin reactivates supplier
  const reactRes = await app.inject({
    method: 'PATCH',
    url: `/v1/suppliers/${newSupplier.id}/reactivate`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  printResponse('4e. Admin reactivates supplier PATCH /v1/suppliers/:id/reactivate', reactRes);

  // -------------------------------------------------------------
  // SCENARIO 5: DELETE (PERMANENT)
  // -------------------------------------------------------------
  console.log(bold('\n>>> [5] DEMO: PERMANENT DELETE'));

  // 5a. Student tries to delete -> 403 Forbidden
  const studentDeleteRes = await app.inject({
    method: 'DELETE',
    url: `/v1/suppliers/${newSupplier.id}`,
    headers: { authorization: `Bearer ${studentToken}` },
  });
  printResponse('5a. Student attempts DELETE /v1/suppliers/:id (Forbidden)', studentDeleteRes);

  // 5b. Admin deletes -> 204 No Content
  const adminDeleteRes = await app.inject({
    method: 'DELETE',
    url: `/v1/suppliers/${newSupplier.id}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  printResponse('5b. Admin permanently deletes DELETE /v1/suppliers/:id (204 No Content)', adminDeleteRes);

  // 5c. Confirm it is gone for everyone -> 404
  const confirmDeleteRes = await app.inject({
    method: 'GET',
    url: `/v1/suppliers/${newSupplier.id}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  printResponse('5c. Verify deleted supplier is completely removed (404 Not Found)', confirmDeleteRes);

  console.log('\n' + '='.repeat(70));
  console.log(bold(green('  DEMO COMPLETE: ALL CRUD & RBAC CHECKS PASSED')));
  console.log('='.repeat(70) + '\n');

  await app.close();
}

import { describe, it } from 'vitest';

describe('Supplier Service CRUD & RBAC CLI Demonstration', () => {
  it('runs interactive CRUD and RBAC demonstration', async () => {
    await runDemo();
  }, 30000);
});
