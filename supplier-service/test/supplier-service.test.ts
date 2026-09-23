import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context.js';
import { decodeCsv, parseSeedTime, seedSuppliers } from '../src/seed.js';
import { app, bearer, cleanup, createTestContext, logout, makeUser, rootEnv } from './helpers.js';

let ctx: AppContext;
let api: ReturnType<typeof app>;
let user: { id: string; token: string };
let admin: { id: string; token: string };

beforeAll(async () => {
  ctx = await createTestContext();
  api = app(ctx);
  [user, admin] = await Promise.all([makeUser('user'), makeUser('admin')]);
});

afterAll(async () => {
  await cleanup(ctx);
});

const newSupplier = (over: Record<string, unknown> = {}) => ({
  name: `Test Stall ${Math.random().toString(36).slice(2, 8)}`,
  facilityType: 'Food',
  building: 'Test Building',
  floor: '2',
  locationDescription: 'Next to the lift',
  opensAt: '00:00',
  closesAt: '23:59',
  tags: ['food'],
  ...over,
});

describe('Seed data (M3)', () => {
  it('parses the template time format', () => {
    expect(parseSeedTime('0900hrs')).toBe('09:00');
    expect(parseSeedTime('2359hrs')).toBe('23:59');
  });

  it('decodes Windows-1252 smart quotes and leaves clean UTF-8 alone', () => {
    expect(decodeCsv(Buffer.from([0x47, 0x92, 0x73]))).toBe("G's");
    expect(decodeCsv(Buffer.from('Café', 'utf8'))).toBe('Café');
  });

  it('loads the 21 template suppliers once, fixing the Windows-1252 apostrophe', async () => {
    expect(await seedSuppliers(ctx)).toBe(21);
    expect(await seedSuppliers(ctx)).toBe(0); // flag set: never re-seeds
    const { rows } = await ctx.pool.query(`SELECT building FROM suppliers WHERE name = 'Octobox'`);
    expect(rows[0].building).toBe("Prince George's Park");
  });
});

describe('Access control using User Service identity + roles', () => {
  it('401 without a token', async () => {
    const res = await request(api).get('/v1/suppliers');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_MISSING');
  });

  it('a regular user can read but gets 403 on every write', async () => {
    expect((await request(api).get('/v1/suppliers').set(bearer(user.token))).status).toBe(200);
    const writes = [
      request(api).post('/v1/suppliers').set(bearer(user.token)).send(newSupplier()),
      request(api).delete('/v1/suppliers?facilityType=Food&confirm=true').set(bearer(user.token)),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    }
  });

  it('a logged-out session is rejected (checked with the User Service)', async () => {
    const temp = await makeUser('user');
    expect((await request(api).get('/v1/suppliers').set(bearer(temp.token))).status).toBe(200);
    await logout(temp.id);
    await new Promise((r) => setTimeout(r, 5_200)); // the 5s session cache (NFR6.1 bound)
    const res = await request(api).get('/v1/suppliers').set(bearer(temp.token));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });
});

describe('CRUD (F8-F10)', () => {
  it('admin creates, reads, updates and deletes a supplier', async () => {
    const created = await request(api).post('/v1/suppliers').set(bearer(admin.token)).send(newSupplier({ name: 'CRUD Cafe' }));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: 'CRUD Cafe', opensAt: '00:00', isActive: true, isOpenNow: true });
    const id = created.body.data.id;

    expect((await request(api).get(`/v1/suppliers/${id}`).set(bearer(user.token))).body.data.name).toBe('CRUD Cafe');

    const updated = await request(api).patch(`/v1/suppliers/${id}`).set(bearer(admin.token)).send({ closesAt: '18:30', building: 'COM3' });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ closesAt: '18:30', building: 'COM3' });

    expect((await request(api).delete(`/v1/suppliers/${id}`).set(bearer(admin.token))).status).toBe(204);
    expect((await request(api).get(`/v1/suppliers/${id}`).set(bearer(admin.token))).status).toBe(404);
  });

  it('enforces unique names (case-insensitive) on create and update', async () => {
    const res = await request(api).post('/v1/suppliers').set(bearer(admin.token)).send(newSupplier({ name: 'nus co-op' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUPPLIER_NAME_TAKEN');
    const other = await request(api).post('/v1/suppliers').set(bearer(admin.token)).send(newSupplier());
    const rename = await request(api).patch(`/v1/suppliers/${other.body.data.id}`).set(bearer(admin.token)).send({ name: 'NUS CO-OP' });
    expect(rename.status).toBe(409);
  });

  it('validates input and refuses unknown fields', async () => {
    const res = await request(api)
      .post('/v1/suppliers')
      .set(bearer(admin.token))
      .send(newSupplier({ opensAt: '9am', isActive: false, name: '' }));
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.details.fieldErrors).sort()).toEqual(['isActive', 'name', 'opensAt']);
  });

  it('deactivated suppliers are kept, hidden from users, visible to admins, and can be reactivated (F9.1-9.2)', async () => {
    const { body } = await request(api).post('/v1/suppliers').set(bearer(admin.token)).send(newSupplier({ name: 'Sleepy Stall' }));
    const id = body.data.id;
    expect((await request(api).patch(`/v1/suppliers/${id}/deactivate`).set(bearer(admin.token))).body.data.isActive).toBe(false);

    expect((await request(api).get(`/v1/suppliers/${id}`).set(bearer(user.token))).status).toBe(404);
    const userList = await request(api).get('/v1/suppliers?search=Sleepy').set(bearer(user.token));
    expect(userList.body.total).toBe(0);
    expect((await request(api).get('/v1/suppliers?status=inactive').set(bearer(user.token))).status).toBe(403);
    const adminList = await request(api).get('/v1/suppliers?status=inactive&search=Sleepy').set(bearer(admin.token));
    expect(adminList.body.total).toBe(1);

    expect((await request(api).patch(`/v1/suppliers/${id}/reactivate`).set(bearer(admin.token))).body.data.isActive).toBe(true);
    expect((await request(api).get(`/v1/suppliers/${id}`).set(bearer(user.token))).status).toBe(200);
  });

  it('bulk delete by facility type needs confirm=true (F10.1.2)', async () => {
    await request(api).post('/v1/suppliers').set(bearer(admin.token)).send(newSupplier({ facilityType: 'Laundry' }));
    await request(api).post('/v1/suppliers').set(bearer(admin.token)).send(newSupplier({ facilityType: 'laundry' }));
    expect((await request(api).delete('/v1/suppliers?facilityType=Laundry').set(bearer(admin.token))).status).toBe(422);
    const res = await request(api).delete('/v1/suppliers?facilityType=Laundry&confirm=true').set(bearer(admin.token));
    expect(res.body.data.deleted).toBe(2);
  });
});

describe('Query patterns (F7.2-F7.3, NFR7.x)', () => {
  it('filters by facility type and building', async () => {
    const coffee = await request(api).get('/v1/suppliers?facilityType=Food/Coffee').set(bearer(user.token));
    expect(coffee.body.total).toBe(5);
    expect(coffee.body.data.every((s: { facilityType: string }) => s.facilityType === 'Food/Coffee')).toBe(true);
    const lib = await request(api).get('/v1/suppliers?building=central library').set(bearer(user.token));
    expect(lib.body.data.map((s: { name: string }) => s.name).sort()).toEqual(["Anna's x Soup Union", 'Cafe+ Robot Cafe', 'NUS Co-op']);
  });

  it('searches name, building and location text', async () => {
    const res = await request(api).get('/v1/suppliers?search=pgp').set(bearer(user.token));
    expect(res.body.data.map((s: { name: string }) => s.name)).toContain('A Hot Hideout');
  });

  it('sorts by name both ways and by location', async () => {
    const asc = await request(api).get('/v1/suppliers?sort=name&limit=50').set(bearer(user.token));
    const names = asc.body.data.map((s: { name: string }) => s.name.toLowerCase());
    expect(names).toEqual([...names].sort());
    const desc = await request(api).get('/v1/suppliers?sort=name&order=desc&limit=50').set(bearer(user.token));
    expect(desc.body.data[0].name.toLowerCase()).toBe(names[names.length - 1]);
    const loc = await request(api).get('/v1/suppliers?sort=location&limit=50').set(bearer(user.token));
    const buildings = loc.body.data.map((s: { building: string }) => s.building.toLowerCase());
    expect(buildings).toEqual([...buildings].sort());
  });

  it('paginates with at most 50 per page', async () => {
    const p1 = await request(api).get('/v1/suppliers?limit=5&page=1').set(bearer(user.token));
    const p2 = await request(api).get('/v1/suppliers?limit=5&page=2').set(bearer(user.token));
    expect(p1.body.data).toHaveLength(5);
    expect(p1.body.data[0].id).not.toBe(p2.body.data[0].id);
    expect(p1.body.total).toBeGreaterThanOrEqual(21);
    expect((await request(api).get('/v1/suppliers?limit=51').set(bearer(user.token))).status).toBe(422);
  });

  it('can list only suppliers open right now', async () => {
    const res = await request(api).get('/v1/suppliers?status=open_now&limit=50').set(bearer(user.token));
    expect(res.status).toBe(200);
    expect(res.body.data.every((s: { isOpenNow: boolean }) => s.isOpenNow)).toBe(true);
    // The 24-hour suppliers are always open.
    expect(res.body.data.map((s: { name: string }) => s.name)).toContain('InstaChef');
  });
});

describe('Internal validation for the Order Service (F10A)', () => {
  it('requires the service secret and reports exists / active / open', async () => {
    const { body } = await request(api).post('/v1/suppliers').set(bearer(admin.token)).send(newSupplier({ name: 'Validate Me' }));
    const path = `/v1/internal/suppliers/${body.data.id}/validate`;
    expect((await request(api).get(path)).status).toBe(401);
    expect((await request(api).get(path).set(bearer(admin.token))).status).toBe(403);

    const ok = await request(api).get(path).set('X-Internal-Auth', rootEnv.INTERNAL_AUTH_SECRET!);
    expect(ok.body.data).toMatchObject({ exists: true, isActive: true, isOpenNow: true, valid: true, reason: null });

    await request(api).patch(`/v1/suppliers/${body.data.id}/deactivate`).set(bearer(admin.token));
    const inactive = await request(api).get(path).set('X-Internal-Auth', rootEnv.INTERNAL_AUTH_SECRET!);
    expect(inactive.body.data).toMatchObject({ valid: false, reason: 'INACTIVE' });

    const missing = await request(api)
      .get('/v1/internal/suppliers/00000000-0000-4000-8000-000000000000/validate')
      .set('X-Internal-Auth', rootEnv.INTERNAL_AUTH_SECRET!);
    expect(missing.body.data).toMatchObject({ exists: false, valid: false, reason: 'NOT_FOUND' });
  });
});
