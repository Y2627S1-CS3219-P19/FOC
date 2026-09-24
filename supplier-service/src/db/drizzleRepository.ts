import { eq, sql, and, or, inArray, ilike, count } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { isOpenNow } from '../utils/time.js';
import type {
  SupplierRepository,
  SupplierDto,
  SupplierEntity,
  ListSuppliersQuery,
} from './repository.js';

export class DrizzleSupplierRepository implements SupplierRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  private toDto(row: schema.Supplier): SupplierDto {
    return {
      ...row,
      isOpenNow: isOpenNow(row.opensAt, row.closesAt, row.isActive),
    };
  }

  async list(query: ListSuppliersQuery, isAdmin: boolean): Promise<{ data: SupplierDto[]; total: number }> {
    const conditions = [];

    if (!isAdmin) {
      conditions.push(eq(schema.suppliers.isActive, true));
    } else {
      if (query.status === 'active') {
        conditions.push(eq(schema.suppliers.isActive, true));
      } else if (query.status === 'inactive') {
        conditions.push(eq(schema.suppliers.isActive, false));
      }
    }

    if (query.facilityType) {
      const types = query.facilityType.split(',').map((t) => t.trim().toLowerCase());
      conditions.push(sql`lower(${schema.suppliers.facilityType}) = ANY(${types}::text[])`);
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

    let dtos = rows.map((r) => this.toDto(r));
    if (query.status === 'open_now') {
      dtos = dtos.filter((s) => s.isOpenNow);
    }

    return { data: dtos, total };
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
