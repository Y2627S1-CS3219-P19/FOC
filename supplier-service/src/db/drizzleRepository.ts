import { eq, sql, and, or, inArray, ilike, count } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { isOpenNow, localHHMM } from '../utils/time.js';
import type {
  SupplierRepository,
  SupplierDto,
  SupplierEntity,
  ListSuppliersQuery,
} from './repository.js';

/**
 * Case-insensitive match on one or more facility types.
 *
 * Not `= ANY(${types}::text[])`: drizzle expands a raw array into a param list, so the cast would
 * see one scalar and Postgres would fail with 22P02.
 */
export function facilityTypeFilter(types: string[]) {
  return inArray(sql`lower(${schema.suppliers.facilityType})`, types);
}

/**
 * Open-now predicate mirroring `isOpenNow(opensAt, closesAt, true, …, tz, 0)`, so counting and
 * pagination see the same rows the DTOs report.
 */
export function openNowFilter(nowHHMM: string) {
  const { opensAt, closesAt } = schema.suppliers;
  return sql`(
    (${opensAt} <= ${closesAt} AND ${nowHHMM} >= ${opensAt} AND ${nowHHMM} <= ${closesAt})
    OR (${opensAt} > ${closesAt} AND (${nowHHMM} >= ${opensAt} OR ${nowHHMM} <= ${closesAt}))
  )`;
}

export class DrizzleSupplierRepository implements SupplierRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private readonly now: () => Date = () => new Date()
  ) {}

  private toDto(row: schema.Supplier): SupplierDto {
    return {
      ...row,
      isOpenNow: isOpenNow(row.opensAt, row.closesAt, row.isActive, this.now()),
    };
  }

  async list(query: ListSuppliersQuery, isAdmin: boolean): Promise<{ data: SupplierDto[]; total: number }> {
    const conditions = [];

    const onlyActive = !isAdmin || query.status === 'active' || query.status === 'open_now';
    const onlyInactive = isAdmin && query.status === 'inactive';
    if (onlyActive) {
      conditions.push(eq(schema.suppliers.isActive, true));
    } else if (onlyInactive) {
      conditions.push(eq(schema.suppliers.isActive, false));
    }

    if (query.status === 'open_now') {
      conditions.push(openNowFilter(localHHMM(this.now())));
    }

    if (query.facilityType) {
      const types = query.facilityType.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (types.length > 0) {
        conditions.push(facilityTypeFilter(types));
      }
    }

    if (query.building) {
      conditions.push(sql`lower(${schema.suppliers.building}) = lower(${query.building})`);
    }

    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(
        or(
          ilike(schema.suppliers.name, pattern),
          ilike(schema.suppliers.building, pattern),
          ilike(schema.suppliers.locationDescription, pattern)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total matching records
    const [countResult] = await this.db
      .select({ count: count() })
      .from(schema.suppliers)
      .where(whereClause);
    const total = countResult?.count ?? 0;

    // Sort order
    let orderExpr;
    if (query.sort === 'name') {
      orderExpr = query.order === 'desc' ? sql`lower(${schema.suppliers.name}) DESC` : sql`lower(${schema.suppliers.name}) ASC`;
    } else if (query.sort === 'facilityType') {
      orderExpr = query.order === 'desc' ? sql`lower(${schema.suppliers.facilityType}) DESC` : sql`lower(${schema.suppliers.facilityType}) ASC`;
    } else if (query.sort === 'location') {
      orderExpr = query.order === 'desc' ? sql`lower(${schema.suppliers.building}) DESC, ${schema.suppliers.floor} DESC NULLS LAST` : sql`lower(${schema.suppliers.building}) ASC, ${schema.suppliers.floor} ASC NULLS LAST`;
    } else {
      orderExpr = sql`lower(${schema.suppliers.name}) ASC`;
    }

    const offset = (query.page - 1) * query.limit;
    const rows = await this.db
      .select()
      .from(schema.suppliers)
      .where(whereClause)
      .orderBy(orderExpr)
      .offset(offset)
      .limit(query.limit);

    return { data: rows.map((r) => this.toDto(r)), total };
  }

  async getFilterOptions(isAdmin: boolean): Promise<{ facilityTypes: string[]; buildings: string[] }> {
    const where = !isAdmin ? eq(schema.suppliers.isActive, true) : undefined;

    const [typeRows, buildingRows] = await Promise.all([
      this.db
        .selectDistinct({ type: schema.suppliers.facilityType })
        .from(schema.suppliers)
        .where(where),
      this.db
        .selectDistinct({ building: schema.suppliers.building })
        .from(schema.suppliers)
        .where(where),
    ]);

    const facilityTypes = typeRows.map((r) => r.type).sort();
    const buildings = buildingRows.map((r) => r.building).sort();

    return { facilityTypes, buildings };
  }

  async findById(id: string): Promise<SupplierDto | null> {
    const rows = await this.db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id));
    const found = rows[0];
    return found ? this.toDto(found) : null;
  }

  async create(data: Omit<SupplierEntity, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>): Promise<SupplierDto> {
    const [inserted] = await this.db
      .insert(schema.suppliers)
      .values(data)
      .returning();
    return this.toDto(inserted!);
  }

  async update(id: string, data: Partial<Omit<SupplierEntity, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>>): Promise<SupplierDto | null> {
    const [updated] = await this.db
      .update(schema.suppliers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.suppliers.id, id))
      .returning();
    return updated ? this.toDto(updated) : null;
  }

  async setActive(id: string, isActive: boolean): Promise<SupplierDto | null> {
    const [updated] = await this.db
      .update(schema.suppliers)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(schema.suppliers.id, id))
      .returning();
    return updated ? this.toDto(updated) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.suppliers)
      .where(eq(schema.suppliers.id, id))
      .returning();
    return deleted.length > 0;
  }

  async deleteByFacilityType(facilityType: string): Promise<number> {
    const deleted = await this.db
      .delete(schema.suppliers)
      .where(sql`lower(${schema.suppliers.facilityType}) = lower(${facilityType})`)
      .returning();
    return deleted.length;
  }
}
