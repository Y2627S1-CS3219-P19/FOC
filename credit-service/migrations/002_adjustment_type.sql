-- Add ADJUSTMENT as a valid ledger entry type for admin credit adjustments.
ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_type_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_type_check
  CHECK (type IN ('ISSUANCE', 'RESERVE', 'SETTLE_DEBIT', 'SETTLE_CREDIT', 'RELEASE', 'ADJUSTMENT'));
