-- Fund ledger.

CREATE TABLE IF NOT EXISTS fund_ledger_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_type     text NOT NULL CHECK (fund_type IN ('CORPUS', 'SINKING')),
  entry_type    text NOT NULL CHECK (entry_type IN ('CONTRIBUTION', 'INTEREST', 'OUTFLOW')),
  amount        numeric(12, 2) NOT NULL CHECK (amount > 0),
  entry_date    date NOT NULL,
  -- Optional link back to the existing record this entry represents (e.g. a
  -- CORPUS_FUND other_income row, or a CORPUS_FUND_PAYMENT expenditure row).
  -- NULL for entries recorded directly against the fund (interest credited,
  -- a manual correction) with no corresponding payments/expenditures row.
  source_table  text CHECK (source_table IN ('other_income', 'expenditures')),
  source_id     uuid,
  notes         text,
  is_voided     boolean NOT NULL DEFAULT false,
  void_reason   text,
  voided_at     timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- Prevents double-backfill if this migration (or a future backfill script)
-- runs twice; NULL source_id rows (manual entries) are unaffected — Postgres
-- unique constraints don't treat NULLs as equal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_ledger_source
  ON fund_ledger_entries(source_table, source_id) WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fund_ledger_fund_type ON fund_ledger_entries(fund_type) WHERE NOT is_voided;
CREATE INDEX IF NOT EXISTS idx_fund_ledger_entry_date ON fund_ledger_entries(entry_date);

ALTER TABLE fund_ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fund_ledger_authenticated_all" ON fund_ledger_entries
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Same hard-delete guarantee as every other financial table (payments,
-- bills, expenditures, amc_collections) — void, never delete.
CREATE OR REPLACE FUNCTION prevent_hard_delete_fund_ledger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Hard delete on fund_ledger_entries is not permitted. Void the record instead (is_voided = true).';
END;
$$;

CREATE TRIGGER tg_prevent_fund_ledger_delete
  BEFORE DELETE ON fund_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete_fund_ledger();

CREATE TRIGGER trg_audit_fund_ledger
  AFTER INSERT OR UPDATE ON fund_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- One-time backfill of existing CORPUS_FUND-categorised rows into the ledger,
-- so the new table reflects full history on day one rather than starting
-- empty while the old category data silently keeps accruing separately.
-- Idempotent via the unique index above.
INSERT INTO fund_ledger_entries (fund_type, entry_type, amount, entry_date, source_table, source_id, notes)
SELECT 'CORPUS', 'CONTRIBUTION', amount, income_date, 'other_income', id,
       'Backfilled from other_income (category = CORPUS_FUND) — migration 026'
FROM other_income
WHERE category = 'CORPUS_FUND' AND NOT is_voided AND income_date IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO fund_ledger_entries (fund_type, entry_type, amount, entry_date, source_table, source_id, notes)
SELECT 'CORPUS', 'OUTFLOW', amount, expense_date, 'expenditures', id,
       'Backfilled from expenditures (category = CORPUS_FUND_PAYMENT) — migration 026'
FROM expenditures
WHERE category = 'CORPUS_FUND_PAYMENT' AND NOT is_voided
ON CONFLICT DO NOTHING;
