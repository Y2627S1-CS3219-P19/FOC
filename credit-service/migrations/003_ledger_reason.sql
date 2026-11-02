-- Why an admin adjusted credits. NULL for every other ledger type. Shown to admins only.
ALTER TABLE ledger ADD COLUMN reason text NULL;
