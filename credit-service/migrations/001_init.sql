-- Credit Service schema (credits_db). Manages the closed credit economy where
-- total credits in circulation = total users * initial allocation, always.

CREATE TABLE wallets (
  user_id           uuid PRIMARY KEY,           -- cross-service ref to User Service (Keycloak sub)
  available_balance integer NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  reserved_balance  integer NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reservations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL UNIQUE,           -- cross-service ref to Order Service, one reservation per order
  requester_id   uuid NOT NULL,                  -- user who placed the order (cross-service ref)
  amount         integer NOT NULL CHECK (amount > 0),
  status         text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'SETTLED', 'RELEASED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  settled_at     timestamptz NULL,
  released_at    timestamptz NULL
);
CREATE INDEX reservations_requester_idx ON reservations (requester_id, created_at DESC);
CREATE INDEX reservations_status_idx ON reservations (status);

-- Append-only audit trail of every credit movement.
CREATE TABLE ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES wallets (user_id),
  reservation_id  uuid NULL REFERENCES reservations (id),
  type            text NOT NULL CHECK (type IN ('ISSUANCE', 'RESERVE', 'SETTLE_DEBIT', 'SETTLE_CREDIT', 'RELEASE')),
  amount          integer NOT NULL,              -- signed: negative for debits, positive for credits
  balance_after   integer NOT NULL,              -- available_balance snapshot after this movement
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_idx ON ledger (user_id, created_at DESC);

-- Prevent any modification to ledger rows.
CREATE FUNCTION forbid_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only';
END;
$$;
CREATE TRIGGER ledger_immutable
  BEFORE UPDATE OR DELETE ON ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();

-- Idempotency table for consumed RabbitMQ events.
CREATE TABLE processed_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       text NOT NULL UNIQUE,
  event_type     text NOT NULL,
  processed_at   timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox for publishing credit events to RabbitMQ (see packages/shared-events).
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

-- One-time flags (e.g. migration markers).
CREATE TABLE system_state (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
