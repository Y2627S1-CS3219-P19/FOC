import type pg from 'pg';
import { conflict } from '@foc/shared-middleware';

export interface SupplierRow {
  id: string;
  name: string;
  facility_type: string;
  building: string;
  floor: string | null;
  location_description: string;
  latitude: number | null;
  longitude: number | null;
  opens_at: string; // "HH:MM:SS"
  closes_at: string;
  is_active: boolean;
  image_path: string | null;
  tags: string[];
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  is_open_now: boolean;
}

/**
 * SQL for "is this supplier open right now?" in local (Singapore) time, including hours that pass midnight
 * (e.g. 11:00-02:00). 23:59 counts as open until the end of the day. `timezone` comes from validated config
 * (never from a request), so it is safe to inline as a literal.
 */
export function openNowSql(timezone: string) {
  if (!/^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/.test(timezone)) throw new Error(`Invalid timezone "${timezone}"`);
  const now = `(date_trunc('minute', now() AT TIME ZONE '${timezone}'))::time`;
  return `(CASE WHEN s.opens_at < s.closes_at THEN ${now} >= s.opens_at AND ${now} <= s.closes_at
               ELSE ${now} >= s.opens_at OR ${now} <= s.closes_at END)`;
}

const hhmm = (t: string) => t.slice(0, 5);

export function toApi(s: SupplierRow) {
  return {
    id: s.id,
    name: s.name,
    facilityType: s.facility_type,
    building: s.building,
    floor: s.floor,
    locationDescription: s.location_description,
    latitude: s.latitude,
    longitude: s.longitude,
    opensAt: hhmm(s.opens_at),
    closesAt: hhmm(s.closes_at),
    isActive: s.is_active,
    isOpenNow: s.is_active && s.is_open_now,
    imageUrl: s.image_path ? `/v1/supplier-images/${encodeURIComponent(s.image_path)}` : null,
    tags: s.tags,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

export type SupplierApi = ReturnType<typeof toApi>;

export function mapSupplierDbError(err: unknown): unknown {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === '23505' && e.constraint === 'suppliers_name_unique') {
    return conflict('SUPPLIER_NAME_TAKEN', 'A supplier with that name already exists.', {
      fieldErrors: { name: 'Supplier name must be unique.' },
    });
  }
  return err;
}

export async function findSupplier(db: pg.Pool | pg.PoolClient, id: string, tz: string): Promise<SupplierRow | null> {
  const { rows } = await db.query<SupplierRow>(`SELECT s.*, ${openNowSql(tz)} AS is_open_now FROM suppliers s WHERE s.id = $1`, [id]);
  return rows[0] ?? null;
}
