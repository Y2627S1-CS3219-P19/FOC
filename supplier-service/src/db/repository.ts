import { isOpenNow } from '../utils/time.js';

export interface SupplierEntity {
  id: string;
  name: string;
  facilityType: string;
  building: string;
  floor: string | null;
  locationDescription: string | null;
  latitude: number | null;
  longitude: number | null;
  opensAt: string;
  closesAt: string;
  isActive: boolean;
  imageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierDto extends SupplierEntity {
  isOpenNow: boolean;
}

export interface ListSuppliersQuery {
  search?: string;
  facilityType?: string;
  building?: string;
  status: 'active' | 'open_now' | 'inactive' | 'all';
  sort: 'name' | 'location' | 'facilityType';
  order: 'asc' | 'desc';
  page: number;
  limit: number;
}

export interface SupplierRepository {
  list(query: ListSuppliersQuery, isAdmin: boolean): Promise<{ data: SupplierDto[]; total: number }>;
  getFilterOptions(isAdmin: boolean): Promise<{ facilityTypes: string[]; buildings: string[] }>;
  findById(id: string): Promise<SupplierDto | null>;
  create(data: Omit<SupplierEntity, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>): Promise<SupplierDto>;
  update(id: string, data: Partial<Omit<SupplierEntity, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>>): Promise<SupplierDto | null>;
  setActive(id: string, isActive: boolean): Promise<SupplierDto | null>;
  deleteById(id: string): Promise<boolean>;
  deleteByFacilityType(facilityType: string): Promise<number>;
}

export class InMemorySupplierRepository implements SupplierRepository {
  private suppliers: Map<string, SupplierEntity> = new Map();

  constructor(initialData: SupplierEntity[] = []) {
    for (const item of initialData) {
      this.suppliers.set(item.id, { ...item });
    }
  }

  private toDto(s: SupplierEntity): SupplierDto {
    return {
      ...s,
      isOpenNow: isOpenNow(s.opensAt, s.closesAt, s.isActive),
    };
  }

  async list(query: ListSuppliersQuery, isAdmin: boolean): Promise<{ data: SupplierDto[]; total: number }> {
    let items = Array.from(this.suppliers.values()).map((s) => this.toDto(s));

    // Access control: regular students can only see active suppliers
    if (!isAdmin) {
      items = items.filter((s) => s.isActive);
    } else {
      if (query.status === 'active') {
        items = items.filter((s) => s.isActive);
      } else if (query.status === 'inactive') {
        items = items.filter((s) => !s.isActive);
      }
      // 'all' includes active and inactive
    }

    if (query.status === 'open_now') {
      items = items.filter((s) => s.isActive && s.isOpenNow);
    }

    if (query.search) {
      const q = query.search.toLowerCase();
      items = items.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.building.toLowerCase().includes(q) ||
          (s.locationDescription && s.locationDescription.toLowerCase().includes(q))
      );
    }

    if (query.facilityType) {
      const types = query.facilityType.split(',').map((t) => t.trim().toLowerCase());
      items = items.filter((s) => types.includes(s.facilityType.toLowerCase()));
    }

    if (query.building) {
      const b = query.building.toLowerCase();
      items = items.filter((s) => s.building.toLowerCase() === b);
    }

    // Sort
    items.sort((a, b) => {
      let cmp = 0;
      if (query.sort === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (query.sort === 'facilityType') {
        cmp = a.facilityType.localeCompare(b.facilityType);
      } else if (query.sort === 'location') {
        cmp = a.building.localeCompare(b.building) || (a.floor ?? '').localeCompare(b.floor ?? '');
      }
      return query.order === 'desc' ? -cmp : cmp;
    });

    const total = items.length;
    const offset = (query.page - 1) * query.limit;
    const paginated = items.slice(offset, offset + query.limit);

    return { data: paginated, total };
  }

  async getFilterOptions(isAdmin: boolean): Promise<{ facilityTypes: string[]; buildings: string[] }> {
    let items = Array.from(this.suppliers.values());
    if (!isAdmin) {
      items = items.filter((s) => s.isActive);
    }

    const types = Array.from(new Set(items.map((s) => s.facilityType))).sort();
    const buildings = Array.from(new Set(items.map((s) => s.building))).sort();

    return { facilityTypes: types, buildings };
  }

  async findById(id: string): Promise<SupplierDto | null> {
    const found = this.suppliers.get(id);
    return found ? this.toDto(found) : null;
  }

  async create(data: Omit<SupplierEntity, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>): Promise<SupplierDto> {
    // Check uniqueness of name (case-insensitive)
    for (const item of this.suppliers.values()) {
      if (item.name.toLowerCase() === data.name.toLowerCase()) {
        const error = new Error('Supplier name already taken');
        (error as any).code = '23505';
        throw error;
      }
    }

    const now = new Date();
    const entity: SupplierEntity = {
      ...data,
      id: crypto.randomUUID(),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.suppliers.set(entity.id, entity);
    return this.toDto(entity);
  }

  async update(id: string, data: Partial<Omit<SupplierEntity, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>>): Promise<SupplierDto | null> {
    const existing = this.suppliers.get(id);
    if (!existing) return null;

    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      for (const item of this.suppliers.values()) {
        if (item.id !== id && item.name.toLowerCase() === data.name.toLowerCase()) {
          const error = new Error('Supplier name already taken');
          (error as any).code = '23505';
          throw error;
        }
      }
    }

    const updated: SupplierEntity = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.suppliers.set(id, updated);
    return this.toDto(updated);
  }

  async setActive(id: string, isActive: boolean): Promise<SupplierDto | null> {
    const existing = this.suppliers.get(id);
    if (!existing) return null;

    const updated: SupplierEntity = {
      ...existing,
      isActive,
      updatedAt: new Date(),
    };
    this.suppliers.set(id, updated);
    return this.toDto(updated);
  }

  async deleteById(id: string): Promise<boolean> {
    return this.suppliers.delete(id);
  }

  async deleteByFacilityType(facilityType: string): Promise<number> {
    let deletedCount = 0;
    const lowerType = facilityType.toLowerCase();
    for (const [id, item] of this.suppliers.entries()) {
      if (item.facilityType.toLowerCase() === lowerType) {
        this.suppliers.delete(id);
        deletedCount++;
      }
    }
    return deletedCount;
  }
}
