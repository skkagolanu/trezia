-- Rls v2 tenant scoped.
DROP POLICY IF EXISTS "config_admin_all" ON society_config;

CREATE POLICY "config_write_all" ON society_config
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "config_read_only" ON society_config
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

-- ── units ──────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "units_admin_all" ON units;
DROP POLICY IF EXISTS "units_resident_select_own" ON units;

CREATE POLICY "units_write_all" ON units
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "units_read_only" ON units
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "units_resident_select_own" ON units
  FOR SELECT TO authenticated
  USING (
    (select auth_profile_role()) = 'resident'
    AND id = (select auth_profile_unit_id())
    AND society_id = (select auth_profile_society_id())
  );

-- ── residents (PII) — read_tier includes committee/auditor by design; see
--    migration header for the governance-visibility reasoning ─────────────────
DROP POLICY IF EXISTS "residents_admin_all" ON residents;

CREATE POLICY "residents_write_all" ON residents
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "residents_read_only" ON residents
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

-- ── payments ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "payments_admin_all" ON payments;
DROP POLICY IF EXISTS "payments_resident_select_own" ON payments;

CREATE POLICY "payments_write_all" ON payments
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "payments_read_only" ON payments
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "payments_resident_select_own" ON payments
  FOR SELECT TO authenticated
  USING (
    (select auth_profile_role()) = 'resident'
    AND unit_id = (select auth_profile_unit_id())
    AND society_id = (select auth_profile_society_id())
  );

-- ── bills ──────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bills_admin_all" ON bills;
DROP POLICY IF EXISTS "bills_resident_select_own" ON bills;

CREATE POLICY "bills_write_all" ON bills
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "bills_read_only" ON bills
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "bills_resident_select_own" ON bills
  FOR SELECT TO authenticated
  USING (
    (select auth_profile_role()) = 'resident'
    AND unit_id = (select auth_profile_unit_id())
    AND society_id = (select auth_profile_society_id())
  );

-- ── expenditures ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "expenditures_admin_all" ON expenditures;

CREATE POLICY "expenditures_write_all" ON expenditures
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "expenditures_read_only" ON expenditures
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

-- ── other_income ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "other_income_admin_all" ON other_income;

CREATE POLICY "other_income_write_all" ON other_income
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "other_income_read_only" ON other_income
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

-- ── audit_log ──────────────────────────────────────────────────────────────────
-- "audit_admin_select" already meant owner/treasurer only (not committee) in
-- spirit — auditor's whole purpose is reading this, so read_tier is correct
-- here, not a widening of an existing admin-only boundary.
DROP POLICY IF EXISTS "audit_admin_select" ON audit_log;

CREATE POLICY "audit_read_only" ON audit_log
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

-- "audit_log_insert" (migration 016, INSERT WITH CHECK true) is untouched —
-- inserts only ever happen via triggers carrying the correct society_id from
-- the row that fired them; there is no cross-tenant read exposure from an
-- insert-only permissive policy.

-- ── balance_snapshots ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "snapshots_admin_all" ON balance_snapshots;

CREATE POLICY "snapshots_write_all" ON balance_snapshots
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "snapshots_read_only" ON balance_snapshots
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

-- ── amc_collections ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "amc_admin_all" ON amc_collections;
DROP POLICY IF EXISTS "amc_resident_select_own" ON amc_collections;

CREATE POLICY "amc_write_all" ON amc_collections
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "amc_read_only" ON amc_collections
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "amc_resident_select_own" ON amc_collections
  FOR SELECT TO authenticated
  USING (
    (select auth_profile_role()) = 'resident'
    AND unit_id = (select auth_profile_unit_id())
    AND society_id = (select auth_profile_society_id())
  );

-- ── treasurer_handovers ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "handovers_admin_all" ON treasurer_handovers;

CREATE POLICY "handovers_write_all" ON treasurer_handovers
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "handovers_read_only" ON treasurer_handovers
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

-- ── levy_configs ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "levy_configs_admin_all" ON levy_configs;
DROP POLICY IF EXISTS "levy_configs_resident_select" ON levy_configs;

CREATE POLICY "levy_configs_write_all" ON levy_configs
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "levy_configs_read_only" ON levy_configs
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "levy_configs_resident_select" ON levy_configs
  FOR SELECT TO authenticated
  USING (
    (select auth_profile_role()) = 'resident'
    AND society_id = (select auth_profile_society_id())
  );


DROP POLICY IF EXISTS "opening_balances_authenticated_all" ON opening_balances;

CREATE POLICY "opening_balances_write_all" ON opening_balances
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "opening_balances_read_only" ON opening_balances
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));


DROP POLICY IF EXISTS "fund_ledger_authenticated_all" ON fund_ledger_entries;

CREATE POLICY "fund_ledger_write_all" ON fund_ledger_entries
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "fund_ledger_read_only" ON fund_ledger_entries
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));


DROP POLICY IF EXISTS "advance_settlements_authenticated_all" ON advance_settlements;

CREATE POLICY "advance_settlements_write_all" ON advance_settlements
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "advance_settlements_read_only" ON advance_settlements
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));


DROP POLICY IF EXISTS "bank_statement_batches_authenticated_all" ON bank_statement_batches;
DROP POLICY IF EXISTS "bank_statement_lines_authenticated_all" ON bank_statement_lines;

CREATE POLICY "bank_statement_batches_write_all" ON bank_statement_batches
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "bank_statement_batches_read_only" ON bank_statement_batches
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

CREATE POLICY "bank_statement_lines_write_all" ON bank_statement_lines
  FOR ALL TO authenticated
  USING (
    (select auth_write_tier())
    AND EXISTS (
      SELECT 1 FROM bank_statement_batches b
      WHERE b.id = bank_statement_lines.batch_id
        AND b.society_id = (select auth_profile_society_id())
    )
  )
  WITH CHECK (
    (select auth_write_tier())
    AND EXISTS (
      SELECT 1 FROM bank_statement_batches b
      WHERE b.id = bank_statement_lines.batch_id
        AND b.society_id = (select auth_profile_society_id())
    )
  );

CREATE POLICY "bank_statement_lines_read_only" ON bank_statement_lines
  FOR SELECT TO authenticated
  USING (
    (select auth_read_tier())
    AND EXISTS (
      SELECT 1 FROM bank_statement_batches b
      WHERE b.id = bank_statement_lines.batch_id
        AND b.society_id = (select auth_profile_society_id())
    )
  );

-- ── log_audit_event(): populate society_id on every audited INSERT/UPDATE ─────
-- Generic across every audited table because they all now carry society_id —
-- so the log always reflects the actual row's tenant even for service-role
-- writes (which have no "calling user" society to fall back on).
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (action, table_name, record_id, new_data, performed_by, society_id)
    VALUES (
      'INSERT', TG_TABLE_NAME, NEW.id::TEXT,
      row_to_json(NEW)::JSONB,
      COALESCE(current_setting('app.current_user', TRUE), 'system'),
      (row_to_json(NEW)::JSONB->>'society_id')::uuid
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (action, table_name, record_id, old_data, new_data, performed_by, society_id)
    VALUES (
      'UPDATE', TG_TABLE_NAME, NEW.id::TEXT,
      row_to_json(OLD)::JSONB,
      row_to_json(NEW)::JSONB,
      COALESCE(current_setting('app.current_user', TRUE), 'system'),
      (row_to_json(NEW)::JSONB->>'society_id')::uuid
    );
  END IF;
  RETURN NULL;
END;
$$;
