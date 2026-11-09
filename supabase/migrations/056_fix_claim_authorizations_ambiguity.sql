-- Fix claim authorizations ambiguity.

CREATE OR REPLACE FUNCTION public.claim_access_authorizations(p_user_id uuid, p_email text)
RETURNS TABLE(app_role text, unit_id uuid, society_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_invite public.resident_invites%ROWTYPE;
  v_existing public.society_memberships%ROWTYPE;
  v_first public.resident_invites%ROWTYPE;
  v_found boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_user_id AND lower(u.email) = lower(trim(p_email))
  ) THEN
    RAISE EXCEPTION 'AUTH_IDENTITY_MISMATCH';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)), 0));

  FOR v_invite IN
    SELECT i.* FROM public.resident_invites i
    WHERE lower(i.email) = lower(trim(p_email))
      AND i.claimed_at IS NULL AND i.revoked_at IS NULL
    ORDER BY i.created_at, i.id FOR UPDATE
  LOOP
    IF v_invite.role NOT IN ('admin', 'treasurer', 'resident') THEN
      RAISE EXCEPTION 'ROLE_NOT_SUPPORTED';
    END IF;

    SELECT * INTO v_existing FROM public.society_memberships m
      WHERE m.user_id = p_user_id AND m.society_id = v_invite.society_id
      FOR UPDATE;
    v_found := FOUND;

    -- Leave the invite unclaimed and keep going: aborting here would roll back
    -- every other society's valid claim and strand a user who already has
    -- working access. The unclaimed row stays visible for an admin to revoke.
    IF v_found AND v_existing.status = 'active'
      AND (v_existing.role <> v_invite.role OR v_existing.unit_id IS DISTINCT FROM v_invite.unit_id) THEN
      INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
      VALUES ('UPDATE', 'resident_invites', v_invite.id::text,
        jsonb_build_object('invite_role', v_invite.role, 'invite_unit_id', v_invite.unit_id,
                           'existing_role', v_existing.role, 'existing_unit_id', v_existing.unit_id),
        p_user_id::text, v_invite.society_id,
        'Access authorization skipped: conflicts with existing active membership');
      CONTINUE;
    END IF;

    INSERT INTO public.society_memberships (user_id, society_id, role, unit_id, status)
    VALUES (p_user_id, v_invite.society_id, v_invite.role, v_invite.unit_id, 'active')
    ON CONFLICT (user_id, society_id) DO UPDATE SET
      role = EXCLUDED.role, unit_id = EXCLUDED.unit_id, status = 'active',
      revoked_at = NULL, revoked_by = NULL, updated_at = now();

    UPDATE public.resident_invites i
      SET claimed_at = now(), claimed_by = p_user_id
      WHERE i.id = v_invite.id;

    INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
    VALUES ('UPDATE', 'resident_invites', v_invite.id::text,
      jsonb_build_object('role', v_invite.role, 'unit_id', v_invite.unit_id),
      p_user_id::text, v_invite.society_id, 'Access authorization claimed');

    IF v_first.id IS NULL THEN v_first := v_invite; END IF;
    RETURN QUERY SELECT v_invite.role, v_invite.unit_id, v_invite.society_id;
  END LOOP;

  -- Compatibility only while legacy profile columns remain during staged rollout.
  IF v_first.id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id) THEN
    INSERT INTO public.profiles (id, role, unit_id, society_id)
    VALUES (p_user_id, v_first.role, v_first.unit_id, v_first.society_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_access_authorizations(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_access_authorizations(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
