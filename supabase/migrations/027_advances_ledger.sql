-- Advances ledger.

CREATE TABLE IF NOT EXISTS advance_settlements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The original advance record. No DB-level FK is possible since it points
  -- at one of two different tables depending on advance_kind — app code is
  -- responsible for verifying advance_id exists in the right table before
  -- insert (same pattern as amc_collections.unit_id verification in API routes).
  advance_kind    text NOT NULL CHECK (advance_kind IN ('PAYMENT', 'EXPENSE')),
  advance_id      uuid NOT NULL,
  settled_amount  numeric(12, 2) NOT NULL CHECK (settled_amount > 0),
  -- Free text, not a FK: what the advance was applied against (e.g. "May 2026
  -- maintenance bill", "Reimbursed against June generator diesel invoice").
  -- A future iteration could link settled_amount to a specific bills.id /
  -- expenditures.id once a concrete UI decides how settlement is recorded.
  settled_against text NOT NULL,
  settled_date    date NOT NULL,
  notes           text,
  is_voided       boolean NOT NULL DEFAULT false,
  void_reason     text,
  voided_at       timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_advance_settlements_advance
  ON advance_settlements(advance_kind, advance_id) WHERE NOT is_voided;

ALTER TABLE advance_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advance_settlements_authenticated_all" ON advance_settlements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION prevent_hard_delete_advance_settlements()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Hard delete on advance_settlements is not permitted. Void the record instead (is_voided = true).';
END;
$$;

CREATE TRIGGER tg_prevent_advance_settlements_delete
  BEFORE DELETE ON advance_settlements
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete_advance_settlements();

CREATE TRIGGER trg_audit_advance_settlements
  AFTER INSERT OR UPDATE ON advance_settlements
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();
