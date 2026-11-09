-- Rls resident scope.
CREATE OR REPLACE FUNCTION public.auth_profile_role()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (SELECT role FROM public.profiles WHERE id = auth.uid());
END;
$$;

-- Returns the calling user's unit_id (residents only). Returns NULL for admins/no-profile.
CREATE OR REPLACE FUNCTION public.auth_profile_unit_id()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (SELECT unit_id FROM public.profiles WHERE id = auth.uid() AND role = 'resident');
END;
$$;

-- ── society_config ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "treasurer_all_config" ON society_config;

CREATE POLICY "config_admin_all" ON society_config
  FOR ALL TO authenticated
  USING (auth_profile_role() = 'admin')
  WITH CHECK (auth_profile_role() = 'admin');

-- ── units ──────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "treasurer_all_units" ON units;

CREATE POLICY "units_admin_all" ON units
  FOR ALL TO authenticated
  USING (auth_profile_role() = 'admin')
  WITH CHECK (auth_profile_role() = 'admin');

-- Residents can see their own unit only (flat_number, monthly_amount — no PII)
CREATE POLICY "units_resident_select_own" ON units
  FOR SELECT TO authenticated
  USING (auth_profile_role() = 'resident' AND id = auth_profile_unit_id());

-- ── residents (PII table) ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "treasurer_all_residents" ON residents;

CREATE POLICY "residents_admin_all" ON residents
  FOR ALL TO authenticated
  USING (auth_profile_role() = 'admin')
  WITH CHECK (auth_profile_role() = 'admin');
-- No resident policy: residents cannot read this table (contains phone, email, name of all 55 flats)

-- ── payments ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "treasurer_all_payments" ON payments;

CREATE POLICY "payments_admin_all" ON payments
  FOR ALL TO authenticated
  USING (auth_profile_role() = 'admin')
  WITH CHECK (auth_profile_role() = 'admin');

CREATE POLICY "payments_resident_select_own" ON payments
  FOR SELECT TO authenticated
  USING (auth_profile_role() = 'resident' AND unit_id = auth_profile_unit_id());

-- ── bills ──────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "treasurer_all_bills" ON bills;

CREATE POLICY "bills_admin_all" ON bills
  FOR ALL TO authenticated
  USING (auth_profile_role() = 'admin')
  WITH CHECK (auth_profile_role() = 'admin');

CREATE POLICY "bills_resident_select_own" ON bills
  FOR SELECT TO authenticated
  USING (auth_profile_role() = 'resident' AND unit_id = auth_profile_unit_id());

-- ── expenditures ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "treasurer_all_expenses" ON expenditures;

CREATE POLICY "expenditures_admin_all" ON expenditures
  FOR ALL TO authenticated
  USING (auth_profile_role() = 'admin')
  WITH CHECK (auth_profile_role() = 'admin');

-- ── other_income ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "treasurer_all_income" ON other_income;

CREATE POLICY "other_income_admin_all" ON other_income
  FOR ALL TO authenticated
  USING (auth_profile_role() = 'admin')
  WITH CHECK (auth_profile_role() = 'admin');

-- ── audit_log ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "treasurer_read_audit" ON audit_log;

CREATE POLICY "audit_admin_select" ON audit_log
  FOR SELECT TO authenticated
  USING (auth_profile_role() = 'admin');

-- "audit_log_insert" remains untouched

-- ── balance_snapshots ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "treasurer_all_snapshots" ON balance_snapshots;

CREATE POLICY "snapshots_admin_all" ON balance_snapshots
  FOR ALL TO authenticated
  USING (auth_profile_role() = 'admin')
  WITH CHECK (auth_profile_role() = 'admin');

-- ── amc_collections ────────────────────────────────────────────────────────────
-- Existing policies from migration 010: amc_select, amc_insert, amc_update (all USING true)
DROP POLICY IF EXISTS "amc_select" ON amc_collections;
DROP POLICY IF EXISTS "amc_insert" ON amc_collections;
DROP POLICY IF EXISTS "amc_update" ON amc_collections;

CREATE POLICY "amc_admin_all" ON amc_collections
  FOR ALL TO authenticated
  USING (auth_profile_role() = 'admin')
  WITH CHECK (auth_profile_role() = 'admin');

CREATE POLICY "amc_resident_select_own" ON amc_collections
  FOR SELECT TO authenticated
  USING (auth_profile_role() = 'resident' AND unit_id = auth_profile_unit_id());

-- ── treasurer_handovers ────────────────────────────────────────────────────────
-- Existing policies from migration 010: handover_select, handover_insert, handover_update
DROP POLICY IF EXISTS "handover_select" ON treasurer_handovers;
DROP POLICY IF EXISTS "handover_insert" ON treasurer_handovers;
DROP POLICY IF EXISTS "handover_update" ON treasurer_handovers;

CREATE POLICY "handovers_admin_all" ON treasurer_handovers
  FOR ALL TO authenticated
  USING (auth_profile_role() = 'admin')
  WITH CHECK (auth_profile_role() = 'admin');

-- ── levy_configs ───────────────────────────────────────────────────────────────
-- Residents need to read levy configs (displayed on /my-flat, non-PII pricing info)
DROP POLICY IF EXISTS "levy_configs_authenticated_all" ON levy_configs;

CREATE POLICY "levy_configs_admin_all" ON levy_configs
  FOR ALL TO authenticated
  USING (auth_profile_role() = 'admin')
  WITH CHECK (auth_profile_role() = 'admin');

CREATE POLICY "levy_configs_resident_select" ON levy_configs
  FOR SELECT TO authenticated
  USING (auth_profile_role() = 'resident');
