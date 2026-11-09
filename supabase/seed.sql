-- Seed.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;

-- Routine privileges are deliberately NOT re-granted. Migrations 041-057 revoke the
-- service-only lifecycle RPCs (claim_access_authorizations, create_access_invite,
-- revoke_access_invite, the platform-society functions, …) from anon/authenticated and
-- grant them to service_role alone. A blanket routine grant would quietly dismantle
-- that boundary and make the suite's authorization assertions meaningless.

-- Re-apply the one table-level revoke migrations perform (002_core_tables.sql:196-198).
-- The blanket GRANT above would otherwise undo it: audit_log is append-only, and no
-- client role may rewrite or erase recorded history.
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM anon;
