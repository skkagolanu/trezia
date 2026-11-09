-- Historical full.
ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS fiscal_year TEXT;
ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS recorded_by TEXT;
ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS source_ref TEXT;

-- ─────────────────────────────────────────────
-- AMC / CMC COLLECTIONS (per flat, per levy year)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS amc_collections (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id        uuid NOT NULL REFERENCES units(id),
  resident_id    uuid REFERENCES residents(id),
  levy_label     TEXT NOT NULL,          -- 'CMC-June-22', 'AMC-2023', 'CMC-2024', 'CMC-2025', 'AMC-2026'
  amount_paid    NUMERIC(10,2) NOT NULL CHECK (amount_paid > 0),
  payment_date   DATE,                   -- NULL = date unknown
  payment_mode   TEXT DEFAULT 'MANUAL_COLLECTION',
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amc_unit ON amc_collections(unit_id);
CREATE INDEX IF NOT EXISTS idx_amc_label ON amc_collections(levy_label);

-- RLS: same pattern as other tables — authenticated users can read, service role writes
ALTER TABLE amc_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "amc_select" ON amc_collections FOR SELECT TO authenticated USING (true);
CREATE POLICY "amc_insert" ON amc_collections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "amc_update" ON amc_collections FOR UPDATE TO authenticated USING (true);

-- ─────────────────────────────────────────────
-- TREASURER HANDOVERS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treasurer_handovers (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  handover_date               DATE NOT NULL,
  outgoing_treasurer          TEXT NOT NULL,
  incoming_treasurer          TEXT NOT NULL,
  bank_balance                NUMERIC(12,2),
  cash_in_hand                NUMERIC(12,2),
  outstanding_receivables_note TEXT,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE treasurer_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "handover_select" ON treasurer_handovers FOR SELECT TO authenticated USING (true);
CREATE POLICY "handover_insert" ON treasurer_handovers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "handover_update" ON treasurer_handovers FOR UPDATE TO authenticated USING (true);

-- ─────────────────────────────────────────────
-- Add CORPUS_FUND_PAYMENT to expense_category enum
-- ─────────────────────────────────────────────
DO $$ BEGIN
  ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'CORPUS_FUND_PAYMENT';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
