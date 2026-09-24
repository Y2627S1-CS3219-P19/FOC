import { pgTable, uuid, varchar, doublePrecision, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    facilityType: varchar('facility_type', { length: 50 }).notNull(),
    building: varchar('building', { length: 100 }).notNull(),
    floor: varchar('floor', { length: 10 }),
    locationDescription: varchar('location_description', { length: 300 }),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    opensAt: varchar('opens_at', { length: 5 }).notNull(),
    closesAt: varchar('closes_at', { length: 5 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    imageUrl: varchar('image_url', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('suppliers_name_lower_idx').on(sql`lower(${table.name})`),
    index('suppliers_active_idx').on(table.isActive),
    index('suppliers_facility_type_idx').on(table.facilityType),
    index('suppliers_building_idx').on(table.building),
  ]
);

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
