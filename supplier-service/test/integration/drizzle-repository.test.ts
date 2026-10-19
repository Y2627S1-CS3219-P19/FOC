import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { DrizzleSupplierRepository } from '../../src/db/drizzleRepository.js';
import type { ListSuppliersQuery } from '../../src/db/repository.js';
import { createTestDb, resetDb, hasTestDb, type TestDb } from './db.js';

// 06:00Z is 14:00 in Asia/Singapore, the timezone the repository uses for open/closed.
const clockAt = (iso: string) => () => new Date(iso);
const AT_14_00_SGT = clockAt('2026-10-19T06:00:00Z');

/** 8 active + 1 inactive. 6 of the active ones are open at 14:00 SGT. */
const FIXTURES: schema.NewSupplier[] = [
  { name: 'Alpha Cafe', facilityType: 'Food', building: 'Com 1', floor: '1', locationDescription: 'Near entrance', opensAt: '09:00', closesAt: '18:00' },
  { name: 'Beta Bites', facilityType: 'Food', building: 'Com 2', floor: '2', locationDescription: 'Level 2 corner', opensAt: '09:00', closesAt: '16:00' },
  { name: 'Gamma Grill', facilityType: 'Food/Coffee', building: 'Com 1', floor: '1', locationDescription: 'Opp LT16', opensAt: '11:00', closesAt: '21:30' },
  { name: 'Delta Prints', facilityType: 'Printing', building: 'Com 3', opensAt: '09:00', closesAt: '17:00' },
  { name: 'Epsilon Store', facilityType: 'Shopping', building: 'Com 2', floor: '1', locationDescription: 'Basement', opensAt: '10:00', closesAt: '14:00' },
  { name: 'Zeta Late', facilityType: 'Food', building: 'Com 3', floor: '1', locationDescription: 'Night stall', opensAt: '11:00', closesAt: '02:00' },
  { name: 'Eta Early', facilityType: 'Food', building: 'Com 4', floor: '1', locationDescription: 'Morning only', opensAt: '06:00', closesAt: '08:00' },
  { name: 'Theta Copy', facilityType: 'Printing', building: 'Com 4', floor: '2', locationDescription: 'Library', opensAt: '09:00', closesAt: '10:00' },
  { name: 'Iota Snacks', facilityType: 'Food', building: 'Com 1', floor: '1', locationDescription: 'Kiosk', opensAt: '08:00', closesAt: '21:00', isActive: false },
];

const query = (over: Partial<ListSuppliersQuery> = {}): ListSuppliersQuery => ({
  status: 'active',
  sort: 'name',
  order: 'asc',
  page: 1,
  limit: 10,
  ...over,
});

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

// No admin URL means no database; the suite is skipped instead of failing.
describe.skipIf(!hasTestDb)('DrizzleSupplierRepository', () => {
  let test!: TestDb;
  let repo: DrizzleSupplierRepository;

  beforeAll(async () => {
    test = await createTestDb();
  });

  afterAll(async () => {
    await test?.client.end();
  });

  beforeEach(async () => {
    await resetDb(test.client);
    await test.db.insert(schema.suppliers).values(FIXTURES);
    repo = new DrizzleSupplierRepository(test.db, AT_14_00_SGT);
  });

  describe('facility type filter', () => {
    it('returns the matching suppliers instead of failing', async () => {
      const { data, total } = await repo.list(query({ facilityType: 'Food' }), false);

      expect(total).toBe(4);
      expect(names(data).sort()).toEqual(['Alpha Cafe', 'Beta Bites', 'Eta Early', 'Zeta Late']);
    });

    it('matches several comma-separated types', async () => {
      const { data, total } = await repo.list(query({ facilityType: 'Food,Food/Coffee' }), false);

      expect(total).toBe(5);
      expect(names(data)).toContain('Gamma Grill');
    });

    it('is case-insensitive', async () => {
      const { total } = await repo.list(query({ facilityType: 'fOoD' }), false);

      expect(total).toBe(4);
    });

    it('returns nothing for an unknown type', async () => {
      const { data, total } = await repo.list(query({ facilityType: 'Printing,Nope' }), false);

      expect(total).toBe(2);
      expect(names(data).sort()).toEqual(['Delta Prints', 'Theta Copy']);
    });
  });

  describe('other filters', () => {
    it('filters by building', async () => {
      const { total } = await repo.list(query({ building: 'com 1' }), false);

      expect(total).toBe(2);
    });

    it('searches name, building and location description', async () => {
      expect(names((await repo.list(query({ search: 'alpha' }), false)).data)).toEqual(['Alpha Cafe']);
      expect((await repo.list(query({ search: 'com 3' }), false)).total).toBe(2);
      expect(names((await repo.list(query({ search: 'lt16' }), false)).data)).toEqual(['Gamma Grill']);
    });

    it('sorts by name, facility type and location', async () => {
      expect(names((await repo.list(query({ sort: 'name', order: 'desc' }), false)).data)[0]).toBe('Zeta Late');

      const byType = await repo.list(query({ sort: 'facilityType' }), false);
      expect(byType.data[0].facilityType).toBe('Food');

      const byLocation = await repo.list(query({ sort: 'location' }), false);
      expect(byLocation.data.map((s) => s.building).slice(0, 4)).toEqual(['Com 1', 'Com 1', 'Com 2', 'Com 2']);
    });

    it('paginates without changing the total', async () => {
      const page1 = await repo.list(query({ limit: 5, page: 1 }), false);
      const page2 = await repo.list(query({ limit: 5, page: 2 }), false);

      expect(page1.total).toBe(8);
      expect(page2.total).toBe(8);
      expect(page1.data).toHaveLength(5);
      expect(page2.data).toHaveLength(3);
      expect(names(page2.data)).toEqual(['Gamma Grill', 'Theta Copy', 'Zeta Late']);
    });
  });

  describe('open_now status', () => {
    it('counts and pages only open, active suppliers', async () => {
      const { data, total } = await repo.list(query({ status: 'open_now', limit: 5 }), false);

      expect(total).toBe(6);
      expect(data).toHaveLength(5);
      expect(data.every((s) => s.isOpenNow)).toBe(true);
    });

    it('includes overnight stalls that are open past midnight', async () => {
      const { data } = await repo.list(query({ status: 'open_now' }), false);

      expect(names(data)).toContain('Zeta Late');
      expect(names(data)).not.toContain('Eta Early');
    });
  });

  describe('admin status filters', () => {
    it('hides inactive suppliers from non-admins', async () => {
      const { total } = await repo.list(query({ status: 'all' }), false);

      expect(total).toBe(8);
    });

    it('shows deactivated suppliers to admins on request', async () => {
      expect((await repo.list(query({ status: 'inactive' }), true)).total).toBe(1);
      expect((await repo.list(query({ status: 'all' }), true)).total).toBe(9);
    });
  });

  describe('deleteByFacilityType', () => {
    it('deletes case-insensitively and returns the count', async () => {
      const deleted = await repo.deleteByFacilityType('fOoD');

      expect(deleted).toBe(5);
      expect((await repo.list(query({ status: 'all' }), true)).total).toBe(4);
    });
  });

  describe('getFilterOptions', () => {
    it('lists distinct sorted types and buildings', async () => {
      const options = await repo.getFilterOptions(false);

      expect(options.facilityTypes).toEqual(['Food', 'Food/Coffee', 'Printing', 'Shopping']);
      expect(options.buildings).toEqual(['Com 1', 'Com 2', 'Com 3', 'Com 4']);
    });
  });

  describe('crud', () => {
    const input = {
      name: 'Kappa Kiosk',
      facilityType: 'Food',
      building: 'Com 5',
      floor: null,
      locationDescription: null,
      latitude: null,
      longitude: null,
      opensAt: '09:00',
      closesAt: '18:00',
      imageUrl: null,
    };

    it('creates, updates, deactivates and deletes a supplier', async () => {
      const created = await repo.create(input);
      expect(created.isActive).toBe(true);
      expect(created.isOpenNow).toBe(true);

      const updated = await repo.update(created.id, { name: 'Kappa Kiosk 2' });
      expect(updated?.name).toBe('Kappa Kiosk 2');

      const deactivated = await repo.setActive(created.id, false);
      expect(deactivated?.isActive).toBe(false);
      expect(deactivated?.isOpenNow).toBe(false);

      expect(await repo.findById(created.id)).toMatchObject({ isActive: false });
      expect(await repo.deleteById(created.id)).toBe(true);
      expect(await repo.findById(created.id)).toBeNull();
      expect(await repo.deleteById(created.id)).toBe(false);
    });

    it('rejects a duplicate name regardless of case', async () => {
      await expect(repo.create({ ...input, name: 'alpha cafe' })).rejects.toMatchObject({ code: '23505' });
    });
  });
});
