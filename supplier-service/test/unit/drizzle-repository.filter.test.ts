import { describe, it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../src/db/schema.js';
import { facilityTypeFilter, openNowFilter } from '../../src/db/drizzleRepository.js';

// Query building only: this client is never connected to.
const db = drizzle(postgres('postgres://user:pass@127.0.0.1:1/none'), { schema });

const toQuery = (types: string[]) =>
  db.select().from(schema.suppliers).where(facilityTypeFilter(types)).toSQL();

describe('facility type filter SQL', () => {
  it('binds one parameter per facility type', () => {
    const { sql, params } = toQuery(['food', 'food/coffee']);

    expect(params).toEqual(['food', 'food/coffee']);
    expect(sql).toContain('in ($1, $2)');
  });

  it('binds a single type as a scalar, not an array literal', () => {
    const { sql, params } = toQuery(['food']);

    expect(params).toEqual(['food']);
    expect(sql).toContain('in ($1)');
    // Regression: a `::text[]` cast over one scalar param makes Postgres
    // parse it as an array literal and fail with 22P02.
    expect(sql).not.toContain('text[]');
  });
});

describe('open-now filter SQL', () => {
  it('compares daytime and overnight ranges against the same clock value', () => {
    const { sql, params } = db.select().from(schema.suppliers).where(openNowFilter('14:00')).toSQL();

    expect(params.every((p) => p === '14:00')).toBe(true);
    expect(sql).toContain('"opens_at" <= "suppliers"."closes_at"');
    expect(sql).toContain('"opens_at" > "suppliers"."closes_at"');
  });
});
