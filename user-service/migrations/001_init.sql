-- User Service schema (users_db). Passwords, email-verification tokens and login sessions live in
-- Keycloak, NOT here. users.id is the Keycloak user id (the `sub` claim of every access token).

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id                        uuid PRIMARY KEY,
  username                  text NOT NULL,          -- lowercase, as stored by Keycloak
  email                     citext NOT NULL,        -- @u.nus.edu only (F1.1.2)
  display_name              text NOT NULL,
  contact_number            text NULL,
  default_delivery_location text NULL,
  -- Mirror of the Keycloak realm role, for admin lists and the last-admin guard. Only the
  -- bootstrap and the two-admin role-change workflow write it. Authorization uses the token.
  role                      text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  suspension_reason         text NULL,
  suspended_at              timestamptz NULL,
  suspended_by              uuid NULL,
  rating_sum                integer NOT NULL DEFAULT 0,
  rating_count              integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_key UNIQUE (username),
  CONSTRAINT users_email_key UNIQUE (email)
);
CREATE INDEX users_status_idx ON users (status);
CREATE INDEX users_role_idx ON users (role);
CREATE INDEX users_username_trgm_idx ON users USING gin (username gin_trgm_ops);
CREATE INDEX users_email_trgm_idx ON users USING gin ((email::text) gin_trgm_ops);

-- Two-admin promotion/demotion workflow (F1.1.8, F29.2): one admin requests, a DIFFERENT admin confirms.
CREATE TABLE role_change_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id  uuid NOT NULL REFERENCES users (id),
  from_role       text NOT NULL CHECK (from_role IN ('user', 'admin')),
  to_role         text NOT NULL CHECK (to_role IN ('user', 'admin')),
  reason          text NULL,
  requested_by    uuid NOT NULL REFERENCES users (id),
  decided_by      uuid NULL REFERENCES users (id),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz NULL,
  CHECK (to_role <> from_role),
  -- The approver can never be the requester. (A rejection may come from the requester, i.e. a cancel.)
  CHECK (status <> 'approved' OR decided_by <> requested_by)
);
CREATE UNIQUE INDEX role_change_one_pending_per_user ON role_change_requests (target_user_id) WHERE status = 'pending';
CREATE INDEX role_change_status_idx ON role_change_requests (status, created_at);

-- Immutable admin audit trail (NFR18.2).
CREATE TABLE admin_audit_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              uuid NULL,        -- null only for the system bootstrap
  counterpart_admin_id  uuid NULL,        -- the other admin in a two-admin action (requester of a promotion)
  action                text NOT NULL,
  target_type           text NOT NULL,
  target_id             text NULL,
  details               jsonb NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON admin_audit_log (created_at DESC);
CREATE INDEX admin_audit_admin_idx ON admin_audit_log (admin_id, created_at DESC);

CREATE FUNCTION forbid_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$;
CREATE TRIGGER admin_audit_log_immutable
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();

-- One-time flags, e.g. admin_bootstrap_completed (F29.3).
CREATE TABLE system_state (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox for RabbitMQ (see packages/shared-events).
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
