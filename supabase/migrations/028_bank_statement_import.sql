-- Bank statement import.

CREATE TABLE IF NOT EXISTS bank_statement_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename        text,
  statement_from  date,
  statement_to    date,
  line_count      int NOT NULL DEFAULT 0,
  uploaded_by     uuid REFERENCES auth.users(id),
  uploaded_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       uuid NOT NULL REFERENCES bank_statement_batches(id) ON DELETE CASCADE,
  line_date      date NOT NULL,
  description    text NOT NULL,
  -- Positive = credit (money in), negative = debit (money out) — matches how
  -- bank CSV exports typically sign a single "Amount" column.
  amount         numeric(12, 2) NOT NULL,
  reference      text,
  matched_table  text CHECK (matched_table IN ('payments', 'amc_collections', 'other_income', 'expenditures')),
  matched_id     uuid,
  matched_at     timestamptz,
  matched_by     uuid REFERENCES auth.users(id),
  -- Treasurer can dismiss a line (bank charges, rounding, an inter-account
  -- transfer) without matching it to a financial record.
  is_ignored     boolean NOT NULL DEFAULT false,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_lines_batch ON bank_statement_lines(batch_id);
CREATE INDEX IF NOT EXISTS idx_bank_lines_date ON bank_statement_lines(line_date);
-- The worklist query — every line still needing a decision.
CREATE INDEX IF NOT EXISTS idx_bank_lines_unmatched ON bank_statement_lines(batch_id)
  WHERE matched_id IS NULL AND NOT is_ignored;

ALTER TABLE bank_statement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_statement_batches_authenticated_all" ON bank_statement_batches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "bank_statement_lines_authenticated_all" ON bank_statement_lines
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
