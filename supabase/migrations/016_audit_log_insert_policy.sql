-- Audit log insert policy.
CREATE POLICY "audit_log_insert" ON audit_log
  FOR INSERT WITH CHECK (TRUE);
