-- AI-assisted: Claude Code (Opus 5.5), 2026-10-08. Scope: Order Service schema. Reviewed by <name>.
-- Order Service schema (orders_db). Lines marked DESIGN are choices to confirm.

CREATE TABLE orders (
  -- DESIGN: no DEFAULT. The app makes the id before calling Credit, so the reservation can use it.
  id                             uuid PRIMARY KEY,
  -- DESIGN: ids from other services, no foreign keys (separate databases).
  requester_id                   uuid NOT NULL,
  runner_id                      uuid NULL,
  supplier_id                    uuid NOT NULL,
  -- DESIGN: supplier snapshot taken at creation and never updated.
  supplier_name                  text NOT NULL,
  supplier_facility_type         text NOT NULL,
  supplier_building              text NOT NULL,
  supplier_floor                 text NULL,
  supplier_location_description  text NOT NULL DEFAULT '',
  delivery_location              text NOT NULL CHECK (length(delivery_location) BETWEEN 1 AND 200),
  -- DESIGN: items as a JSON array of plain text descriptions, e.g. ["1x chicken rice", "1x kopi"].
  items                          jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
  credit_amount                  integer NOT NULL CHECK (credit_amount > 0),
  status                         text NOT NULL DEFAULT 'OPEN'
                                 CHECK (status IN ('OPEN', 'ACCEPTED', 'COLLECTED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
  expires_at                     timestamptz NOT NULL,
  -- DESIGN: own column so auto-confirm does not depend on updated_at.
  delivered_at                   timestamptz NULL,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  -- +1 on every transition. Sent in events as orderVersion.
  version                        integer NOT NULL DEFAULT 1,

  CONSTRAINT orders_expiry_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  -- DESIGN: the DB also rejects impossible rows, as a backstop to the state machine.
  CONSTRAINT orders_runner_matches_status
    CHECK ((status IN ('ACCEPTED', 'COLLECTED', 'DELIVERED', 'COMPLETED')) = (runner_id IS NOT NULL)),
  CONSTRAINT orders_runner_not_requester CHECK (runner_id IS NULL OR runner_id <> requester_id),
  CONSTRAINT orders_delivered_at_matches_status
    CHECK ((status IN ('DELIVERED', 'COMPLETED')) = (delivered_at IS NOT NULL))
);

-- DESIGN: partial indexes, because the public listing only ever reads OPEN orders.
CREATE INDEX orders_open_expiry_idx ON orders (expires_at) WHERE status = 'OPEN';
CREATE INDEX orders_open_credit_idx ON orders (credit_amount) WHERE status = 'OPEN';
CREATE INDEX orders_supplier_idx ON orders (supplier_id);
CREATE INDEX orders_building_idx ON orders (lower(supplier_building));
CREATE INDEX orders_facility_type_idx ON orders (lower(supplier_facility_type));
CREATE INDEX orders_requester_idx ON orders (requester_id, created_at DESC);
CREATE INDEX orders_runner_idx ON orders (runner_id, created_at DESC) WHERE runner_id IS NOT NULL;
CREATE INDEX orders_delivered_idx ON orders (delivered_at) WHERE status = 'DELIVERED';

CREATE TABLE order_status_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders (id),
  from_status  text NULL,             -- NULL for the create row
  to_status    text NOT NULL,
  actor_id     uuid NULL,             -- NULL when the system made the change
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  reason       text NULL
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, occurred_at);

-- Transactional outbox. Same table as OUTBOX_TABLE_SQL in packages/shared-events/src/outbox.ts.
CREATE TABLE outbox_events (
  id             uuid PRIMARY KEY,
  exchange       text NOT NULL,
  routing_key    text NOT NULL,
  event_type     text NOT NULL,
  envelope       jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz NULL,
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text NULL
);
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (created_at) WHERE published_at IS NULL;
