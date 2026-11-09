-- Resident own row and claim conflict.
CREATE OR REPLACE FUNCTION public.create_access_invite(
  p_society_id uuid, p_email text, p_role text, p_unit_id uuid, p_actor_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_existing public.resident_invites%ROWTYPE;
  v_invite_id uuid;
BEGIN
  IF p_role NOT IN ('admin', 'treasurer', 'resident') THEN
    RAISE EXCEPTION 'ROLE_NOT_SUPPORTED';
  END IF;
  IF p_role = 'resident' AND p_unit_id IS NULL THEN
    RAISE EXCEPTION 'UNIT_REQUIRED_FOR_RESIDENT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)), 0));


  IF EXISTS (
    SELECT 1
    FROM public.society_memberships m
    JOIN auth.users u ON u.id = m.user_id
    WHERE m.society_id = p_society_id
      AND m.status = 'active'
      AND lower(u.email) = lower(trim(p_email))
      AND (m.role <> p_role OR m.unit_id IS DISTINCT FROM p_unit_id)
  ) THEN
    RAISE EXCEPTION 'ACTIVE_ACCESS_EXISTS';
  END IF;

  SELECT * INTO v_existing FROM public.resident_invites
    WHERE society_id = p_society_id AND lower(email) = lower(trim(p_email)) FOR UPDATE;

  IF FOUND AND v_existing.revoked_at IS NULL THEN
    IF v_existing.claimed_by IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.society_memberships
      WHERE user_id = v_existing.claimed_by AND society_id = p_society_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'ACTIVE_ACCESS_EXISTS';
    END IF;
    IF v_existing.claimed_at IS NULL THEN
      RAISE EXCEPTION 'PENDING_ACCESS_EXISTS';
    END IF;
  END IF;

  INSERT INTO public.resident_invites (society_id, email, role, unit_id, created_by)
  VALUES (p_society_id, lower(trim(p_email)), p_role, p_unit_id, p_actor_id)
  ON CONFLICT (society_id, lower(email)) DO UPDATE SET
    role = EXCLUDED.role, unit_id = EXCLUDED.unit_id, created_by = EXCLUDED.created_by,
    claimed_at = NULL, claimed_by = NULL, revoked_at = NULL, revoked_by = NULL
  RETURNING id INTO v_invite_id;

  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES ('INSERT', 'resident_invites', v_invite_id::text,
    jsonb_build_object('role', p_role, 'unit_id', p_unit_id),
    p_actor_id::text, p_society_id, 'Access authorization created');

  RETURN v_invite_id;
END;
$$;

-- 1b. Skip a conflicting invite instead of aborting the whole claim.
CREATE OR REPLACE FUNCTION public.claim_access_authorizations(p_user_id uuid, p_email text)
RETURNS TABLE(app_role text, unit_id uuid, society_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_invite public.resident_invites%ROWTYPE;
  v_existing public.society_memberships%ROWTYPE;
  v_first public.resident_invites%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id AND lower(email) = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'AUTH_IDENTITY_MISMATCH';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)), 0));

  FOR v_invite IN
    SELECT * FROM public.resident_invites
    WHERE lower(email) = lower(trim(p_email)) AND claimed_at IS NULL AND revoked_at IS NULL
    ORDER BY created_at, id FOR UPDATE
  LOOP
    IF v_invite.role NOT IN ('admin', 'treasurer', 'resident') THEN RAISE EXCEPTION 'ROLE_NOT_SUPPORTED'; END IF;
    SELECT * INTO v_existing FROM public.society_memberships
      WHERE user_id = p_user_id AND society_id = v_invite.society_id FOR UPDATE;

    -- Leave the invite unclaimed and keep going: aborting here would roll back
    -- every other society's valid claim and strand a user who already has
    -- working access. The unclaimed row stays visible for an admin to revoke.
    IF FOUND AND v_existing.status = 'active'
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
    UPDATE public.resident_invites SET claimed_at = now(), claimed_by = p_user_id WHERE id = v_invite.id;
    INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
    VALUES ('UPDATE', 'resident_invites', v_invite.id::text,
      jsonb_build_object('role', v_invite.role, 'unit_id', v_invite.unit_id),
      p_user_id::text, v_invite.society_id, 'Access authorization claimed');
    IF v_first.id IS NULL THEN v_first := v_invite; END IF;
    RETURN QUERY SELECT v_invite.role, v_invite.unit_id, v_invite.society_id;
  END LOOP;

  -- Compatibility only while legacy profile columns remain during staged rollout.
  IF v_first.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    INSERT INTO public.profiles (id, role, unit_id, society_id)
    VALUES (p_user_id, v_first.role, v_first.unit_id, v_first.society_id);
  END IF;
END;
$$;

-- 2. A resident may read the resident rows belonging to their own flat.
DROP POLICY IF EXISTS residents_resident_own ON public.residents;
CREATE POLICY residents_resident_own ON public.residents FOR SELECT TO authenticated
  USING (unit_id = private.auth_membership_unit(society_id));

NOTIFY pgrst, 'reload schema';
