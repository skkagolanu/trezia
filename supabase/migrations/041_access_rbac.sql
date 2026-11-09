-- Access rbac.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE resident_invites DROP CONSTRAINT IF EXISTS resident_invites_role_check;

UPDATE profiles SET role = 'admin' WHERE role = 'owner';
UPDATE resident_invites SET role = 'admin' WHERE role = 'owner';

ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'treasurer', 'committee', 'auditor', 'resident'));
ALTER TABLE resident_invites ADD CONSTRAINT resident_invites_role_check
  CHECK (role IN ('admin', 'treasurer', 'committee', 'auditor', 'resident'));

-- Lockout guard: a deployment that already has users must keep at least one admin
-- through the RBAC cutover. It is deliberately scoped to a populated database — an
-- empty one (fresh install, disaster recovery, the disposable database `npm run
-- test:rls` builds) has no profiles at all and therefore nobody to lock out. Without
-- the EXISTS check this migration made the schema impossible to rebuild from scratch.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles)
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'RBAC migration requires at least one admin profile';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.auth_admin_tier()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_write_tier()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'treasurer')
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_read_tier()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'treasurer')
  );
$$;

-- Configuration and identity master data are Admin-write only.
DROP POLICY IF EXISTS "config_write_all" ON public.society_config;
CREATE POLICY "config_admin_write" ON public.society_config
  FOR ALL TO authenticated
  USING ((SELECT public.auth_admin_tier()) AND society_id = (SELECT public.auth_profile_society_id()))
  WITH CHECK ((SELECT public.auth_admin_tier()) AND society_id = (SELECT public.auth_profile_society_id()));

DROP POLICY IF EXISTS "units_write_all" ON public.units;
CREATE POLICY "units_admin_write" ON public.units
  FOR ALL TO authenticated
  USING ((SELECT public.auth_admin_tier()) AND society_id = (SELECT public.auth_profile_society_id()))
  WITH CHECK ((SELECT public.auth_admin_tier()) AND society_id = (SELECT public.auth_profile_society_id()));

DROP POLICY IF EXISTS "levy_configs_write_all" ON public.levy_configs;
CREATE POLICY "levy_configs_admin_write" ON public.levy_configs
  FOR ALL TO authenticated
  USING ((SELECT public.auth_admin_tier()) AND society_id = (SELECT public.auth_profile_society_id()))
  WITH CHECK ((SELECT public.auth_admin_tier()) AND society_id = (SELECT public.auth_profile_society_id()));

DROP POLICY IF EXISTS "fy_treasurers_write_all" ON public.fy_treasurers;
CREATE POLICY "fy_treasurers_admin_write" ON public.fy_treasurers
  FOR ALL TO authenticated
  USING ((SELECT public.auth_admin_tier()) AND society_id = (SELECT public.auth_profile_society_id()))
  WITH CHECK ((SELECT public.auth_admin_tier()) AND society_id = (SELECT public.auth_profile_society_id()));

-- The generic trigger copies the entire request row, including email and phone.
-- Access lifecycle functions below write deliberately redacted audit events.
DROP TRIGGER IF EXISTS audit_access_requests ON public.access_requests;

CREATE OR REPLACE FUNCTION public.create_access_invite(
  p_society_id uuid, p_email text, p_role text, p_unit_id uuid, p_actor_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_existing public.resident_invites%ROWTYPE;
BEGIN
  IF p_role NOT IN ('resident', 'treasurer') THEN RAISE EXCEPTION 'ROLE_NOT_INVITABLE'; END IF;
  IF p_role = 'resident' AND p_unit_id IS NULL THEN RAISE EXCEPTION 'RESIDENT_UNIT_REQUIRED'; END IF;
  IF p_role = 'treasurer' AND p_unit_id IS NOT NULL THEN RAISE EXCEPTION 'TREASURER_UNIT_NOT_ALLOWED'; END IF;
  IF p_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.units WHERE id = p_unit_id AND society_id = p_society_id
  ) THEN RAISE EXCEPTION 'UNIT_NOT_IN_SOCIETY'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_society_id::text || ':' || lower(trim(p_email)), 0));
  SELECT * INTO v_existing FROM public.resident_invites
  WHERE society_id = p_society_id AND lower(email) = lower(trim(p_email)) FOR UPDATE;
  IF FOUND AND v_existing.claimed_at IS NOT NULL THEN RAISE EXCEPTION 'ACTIVE_ACCESS_EXISTS'; END IF;
  IF FOUND THEN RAISE EXCEPTION 'PENDING_ACCESS_EXISTS'; END IF;

  INSERT INTO public.resident_invites (society_id, email, role, unit_id, invited_by)
  VALUES (p_society_id, lower(trim(p_email)), p_role, p_unit_id, p_actor_id)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES (
    'INSERT', 'resident_invites', v_id::text,
    jsonb_build_object('role', p_role, 'unit_id', p_unit_id),
    p_actor_id::text, p_society_id, 'Access authorized'
  );
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_access_invite(p_user_id uuid, p_email text)
RETURNS TABLE(app_role text, unit_id uuid, society_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_invite public.resident_invites%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)), 0));

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF FOUND THEN
    IF v_profile.role NOT IN ('admin', 'treasurer', 'resident') THEN RAISE EXCEPTION 'ROLE_NOT_SUPPORTED'; END IF;
    RETURN QUERY SELECT v_profile.role, v_profile.unit_id, v_profile.society_id;
    RETURN;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.resident_invites
  WHERE lower(email) = lower(trim(p_email)) AND claimed_at IS NULL;

  IF v_count = 0 THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF v_count > 1 THEN RAISE EXCEPTION 'INVITE_AMBIGUOUS'; END IF;

  SELECT * INTO v_invite
  FROM public.resident_invites
  WHERE lower(email) = lower(trim(p_email)) AND claimed_at IS NULL
  FOR UPDATE;

  IF v_invite.role NOT IN ('admin', 'treasurer', 'resident') THEN
    RAISE EXCEPTION 'ROLE_NOT_SUPPORTED';
  END IF;
  IF v_invite.role = 'resident' AND v_invite.unit_id IS NULL THEN
    RAISE EXCEPTION 'RESIDENT_UNIT_REQUIRED';
  END IF;

  INSERT INTO public.profiles (id, role, unit_id, society_id)
  VALUES (p_user_id, v_invite.role, v_invite.unit_id, v_invite.society_id);

  UPDATE public.resident_invites
  SET claimed_at = now(), claimed_by = p_user_id
  WHERE id = v_invite.id;

  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES (
    'UPDATE', 'resident_invites', v_invite.id::text,
    jsonb_build_object('role', v_invite.role, 'unit_id', v_invite.unit_id),
    p_user_id::text, v_invite.society_id, 'Access claimed and profile created'
  );

  RETURN QUERY SELECT v_invite.role, v_invite.unit_id, v_invite.society_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_access_invite(
  p_invite_id uuid, p_society_id uuid, p_actor_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_invite public.resident_invites%ROWTYPE;
BEGIN
  SELECT * INTO v_invite FROM public.resident_invites
  WHERE id = p_invite_id AND society_id = p_society_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_invite.claimed_by IS NOT NULL THEN
    DELETE FROM public.profiles
    WHERE id = v_invite.claimed_by AND society_id = p_society_id;
  END IF;
  DELETE FROM public.resident_invites WHERE id = p_invite_id;

  INSERT INTO public.audit_log (action, table_name, record_id, performed_by, society_id, notes)
  VALUES ('UPDATE', 'resident_invites', p_invite_id::text, p_actor_id::text, p_society_id, 'Access revoked');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_access_request(
  p_society_id uuid, p_unit_id uuid, p_email text, p_name text, p_phone text
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_resubmitted boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_society_id::text || ':' || lower(trim(p_email)), 0));
  UPDATE public.access_requests SET
    unit_id = p_unit_id,
    submitted_name = nullif(trim(p_name), ''),
    submitted_phone = nullif(trim(p_phone), ''),
    created_at = now()
  WHERE id = (
    SELECT id FROM public.access_requests
    WHERE society_id = p_society_id AND lower(email) = lower(trim(p_email)) AND status = 'PENDING'
    LIMIT 1
  ) RETURNING id INTO v_id;

  v_resubmitted := v_id IS NOT NULL;

  IF v_id IS NULL THEN
    INSERT INTO public.access_requests (society_id, unit_id, email, submitted_name, submitted_phone)
    VALUES (p_society_id, p_unit_id, lower(trim(p_email)), nullif(trim(p_name), ''), nullif(trim(p_phone), ''))
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES (
    CASE WHEN v_resubmitted THEN 'UPDATE'::public.audit_action ELSE 'INSERT'::public.audit_action END,
    'access_requests', v_id::text, jsonb_build_object('unit_id', p_unit_id),
    'public-access-request', p_society_id,
    CASE WHEN v_resubmitted THEN 'Resident access request resubmitted' ELSE 'Resident access requested' END
  );
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_access_request(
  p_request_id uuid, p_action text, p_reason text, p_society_id uuid, p_actor_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_request public.access_requests%ROWTYPE;
  v_invite public.resident_invites%ROWTYPE;
  v_invite_id uuid;
BEGIN
  IF p_action NOT IN ('approve', 'decline') THEN RAISE EXCEPTION 'INVALID_DECISION'; END IF;
  SELECT * INTO v_request FROM public.access_requests
  WHERE id = p_request_id AND society_id = p_society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF v_request.status <> 'PENDING' THEN RAISE EXCEPTION 'REQUEST_ALREADY_HANDLED'; END IF;

  IF p_action = 'approve' THEN
    SELECT * INTO v_invite FROM public.resident_invites
    WHERE society_id = p_society_id AND lower(email) = lower(v_request.email) FOR UPDATE;
    IF FOUND AND v_invite.claimed_by IS NOT NULL THEN RAISE EXCEPTION 'ACTIVE_ACCESS_EXISTS'; END IF;
    IF FOUND AND v_invite.role <> 'resident' THEN RAISE EXCEPTION 'CONFLICTING_ACCESS_EXISTS'; END IF;
    IF FOUND THEN
      UPDATE public.resident_invites
      SET role = 'resident', unit_id = v_request.unit_id
      WHERE id = v_invite.id RETURNING id INTO v_invite_id;
    ELSE
      INSERT INTO public.resident_invites (society_id, email, role, unit_id, invited_by)
      VALUES (p_society_id, lower(v_request.email), 'resident', v_request.unit_id, p_actor_id)
      RETURNING id INTO v_invite_id;
    END IF;
  END IF;

  UPDATE public.access_requests SET
    status = CASE WHEN p_action = 'approve' THEN 'APPROVED' ELSE 'DECLINED' END,
    decline_reason = CASE WHEN p_action = 'decline' THEN nullif(trim(p_reason), '') ELSE NULL END,
    decided_by = p_actor_id,
    decided_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES (
    'UPDATE', 'access_requests', p_request_id::text,
    jsonb_build_object('decision', p_action, 'invite_id', v_invite_id),
    p_actor_id::text, p_society_id, 'Access request decided'
  );
  RETURN v_invite_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_access_invite(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_access_invite(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_access_invite(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_access_request(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decide_access_request(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_access_invite(uuid, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_access_invite(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_access_invite(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_access_request(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_access_request(uuid, text, text, uuid, uuid) TO service_role;
