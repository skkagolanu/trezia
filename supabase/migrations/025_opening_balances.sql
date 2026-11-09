-- Opening balances.

CREATE TABLE IF NOT EXISTS opening_balances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fy_start_year  int NOT NULL UNIQUE,          -- e.g. 2026 for FY 2026-27 (Apr 2026 - Mar 2027)
  bank_balance   numeric(12, 2) NOT NULL DEFAULT 0,
  cash_in_hand   numeric(12, 2) NOT NULL DEFAULT 0,
  notes          text,
  recorded_by    uuid REFERENCES auth.users(id),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE opening_balances ENABLE ROW LEVEL SECURITY;

-- reads/writes are allowed; API routes use the service role and bypass
CREATE POLICY "opening_balances_authenticated_all" ON opening_balances
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_audit_opening_balances
  AFTER INSERT OR UPDATE ON opening_balances
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();
