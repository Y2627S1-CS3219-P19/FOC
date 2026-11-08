-- Adds the `wont_fix` terminal status: an admin closes a ticket without acting on it.
-- 0001 already ran everywhere (schema_migrations), so the CHECK must be replaced here, not there.

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_status_check CHECK (status IN ('open', 'under_review', 'resolved', 'wont_fix'));
