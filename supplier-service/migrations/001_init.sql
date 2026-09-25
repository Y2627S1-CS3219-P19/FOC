-- Supplier Service schema (suppliers_db). A supplier is a campus shop, stall or facility that couriers
-- collect items from. Suppliers are managed by admins; shop owners do not have accounts.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE suppliers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,                 -- unique, case-insensitive (F7.1.1, F8.1.1, F9.3.2)
  facility_type         text NOT NULL,                 -- e.g. Food, Food/Coffee, Printing, Shopping (F7.1.2)
  building              text NOT NULL,                 -- e.g. Central Library (F7.1.3)
  floor                 text NULL,
  location_description  text NOT NULL DEFAULT '',      -- e.g. "Next to NUS Co-op"
  latitude              double precision NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude             double precision NULL CHECK (longitude BETWEEN -180 AND 180),
  opens_at              time NOT NULL,                 -- Singapore local time (F7.1.4)
  closes_at             time NOT NULL,                 -- may be earlier than opens_at = open past midnight
  is_active             boolean NOT NULL DEFAULT true, -- deactivated suppliers are kept (F9.1.1)
  image_path            text NULL,                     -- file name under the images directory
  tags                  text[] NOT NULL DEFAULT '{}',
  created_by            uuid NULL,                     -- admin user id (cross-service reference, no FK)
  updated_by            uuid NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at <> closes_at)
);

CREATE UNIQUE INDEX suppliers_name_unique ON suppliers (lower(name));
CREATE INDEX suppliers_active_idx ON suppliers (is_active);
CREATE INDEX suppliers_facility_type_idx ON suppliers (lower(facility_type));
CREATE INDEX suppliers_location_idx ON suppliers (lower(building), floor);
CREATE INDEX suppliers_name_trgm_idx ON suppliers USING gin (name gin_trgm_ops);
CREATE INDEX suppliers_building_trgm_idx ON suppliers USING gin (building gin_trgm_ops);
CREATE INDEX suppliers_location_desc_trgm_idx ON suppliers USING gin (location_description gin_trgm_ops);
CREATE INDEX suppliers_tags_idx ON suppliers USING gin (tags);

-- One-time flags, e.g. seed_completed (so deleted suppliers are not re-created on restart).
CREATE TABLE system_state (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
