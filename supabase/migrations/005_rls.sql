-- Rls.
ALTER TABLE society_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE units              ENABLE ROW LEVEL SECURITY;
ALTER TABLE residents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills              ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenditures       ENABLE ROW LEVEL SECURITY;
ALTER TABLE other_income       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_snapshots  ENABLE ROW LEVEL SECURITY;

-- Authenticated treasurer: full access to everything
CREATE POLICY "treasurer_all_config"     ON society_config    FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "treasurer_all_units"      ON units             FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "treasurer_all_residents"  ON residents         FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "treasurer_all_payments"   ON payments          FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "treasurer_all_bills"      ON bills             FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "treasurer_all_expenses"   ON expenditures      FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "treasurer_all_income"     ON other_income      FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "treasurer_read_audit"     ON audit_log         FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "treasurer_all_snapshots"  ON balance_snapshots FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- Anon: blocked from everything
CREATE POLICY "block_anon_payments"   ON payments         FOR ALL TO anon USING (FALSE);
CREATE POLICY "block_anon_residents"  ON residents        FOR ALL TO anon USING (FALSE);
CREATE POLICY "block_anon_bills"      ON bills            FOR ALL TO anon USING (FALSE);
CREATE POLICY "block_anon_expenses"   ON expenditures     FOR ALL TO anon USING (FALSE);
CREATE POLICY "block_anon_income"     ON other_income     FOR ALL TO anon USING (FALSE);
CREATE POLICY "block_anon_audit"      ON audit_log        FOR ALL TO anon USING (FALSE);
CREATE POLICY "block_anon_config"     ON society_config   FOR ALL TO anon USING (FALSE);
