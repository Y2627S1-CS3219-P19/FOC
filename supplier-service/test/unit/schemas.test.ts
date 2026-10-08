import { describe, it, expect } from 'vitest';
import {
  createSupplierSchema,
  updateSupplierSchema,
  listQuerySchema,
  idParamSchema,
  bulkDeleteQuerySchema,
} from '../../src/schemas/supplier.js';

describe('Slice 3: Strict Schema Validation & Zero Tags (3NF)', () => {
  const validSupplier = {
    name: 'Cool Spot',
    facilityType: 'Food',
    building: 'Com 2',
    floor: '1',
    locationDescription: 'Opp LT16',
    latitude: 1.2940156,
    longitude: 103.7738478,
    opensAt: '09:00',
    closesAt: '21:30',
    imageUrl: 'https://example.com/COOL_SPOT.jpeg',
  };

  describe('createSupplierSchema', () => {
    it('accepts valid input without tags', () => {
      const parsed = createSupplierSchema.safeParse(validSupplier);
      expect(parsed.success).toBe(true);
    });

    it('strictly rejects payload containing "tags" with 422 validation error', () => {
      const invalid = { ...validSupplier, tags: ['coffee', 'snacks'] };
      const parsed = createSupplierSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors;
        expect(fieldErrors.tags).toBeDefined();
        expect(fieldErrors.tags?.[0]).toMatch(/This field is not allowed/i);
      }
    });

    it('rejects invalid time format (e.g. 25:00 or 9:00)', () => {
      const invalid = { ...validSupplier, opensAt: '25:00' };
      const parsed = createSupplierSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it('rejects when opensAt equals closesAt', () => {
      const invalid = { ...validSupplier, opensAt: '10:00', closesAt: '10:00' };
      const parsed = createSupplierSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.errors[0]?.message).toMatch(/cannot be the same/i);
      }
    });

    it('rejects missing required fields (name, facilityType, building, opensAt, closesAt)', () => {
      const invalid = { building: 'Com 2' };
      const parsed = createSupplierSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe('updateSupplierSchema', () => {
    it('accepts valid partial update', () => {
      const parsed = updateSupplierSchema.safeParse({ name: 'Cool Spot New' });
      expect(parsed.success).toBe(true);
    });

    it('strictly rejects payload containing "tags"', () => {
      const invalid = { name: 'Cool Spot New', tags: ['tea'] };
      const parsed = updateSupplierSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors;
        expect(fieldErrors.tags).toBeDefined();
      }
    });

    it('rejects empty object update', () => {
      const parsed = updateSupplierSchema.safeParse({});
      expect(parsed.success).toBe(false);
    });
  });

  describe('listQuerySchema', () => {
    it('applies defaults for status, sort, order, page, and limit', () => {
      const parsed = listQuerySchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.status).toBe('active');
        expect(parsed.data.sort).toBe('name');
        expect(parsed.data.order).toBe('asc');
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.limit).toBe(20);
      }
    });

    it('accepts open_now and inactive statuses', () => {
      expect(listQuerySchema.safeParse({ status: 'open_now' }).success).toBe(true);
      expect(listQuerySchema.safeParse({ status: 'inactive' }).success).toBe(true);
      expect(listQuerySchema.safeParse({ status: 'all' }).success).toBe(true);
    });
  });

  describe('idParamSchema and bulkDeleteQuerySchema', () => {
    it('validates UUID for idParamSchema', () => {
      expect(idParamSchema.safeParse({ id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }).success).toBe(true);
      expect(idParamSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    });

    it('validates confirm=true for bulkDeleteQuerySchema', () => {
      expect(bulkDeleteQuerySchema.safeParse({ facilityType: 'Food', confirm: 'true' }).success).toBe(true);
      expect(bulkDeleteQuerySchema.safeParse({ facilityType: 'Food', confirm: 'false' }).success).toBe(false);
    });
  });
});
