-- Fix access invite actor column.

CREATE OR REPLACE FUNCTION public.create_access_invite(
  p_society_id uuid, p_email text, p_role text, p_unit_id uuid, p_actor_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_existing public.resident_invites%ROWTYPE;
  v_invite_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.society_memberships
    WHERE user_id = p_actor_id AND society_id = p_society_id
      AND role = 'admin' AND status = 'active'
  ) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.societies WHERE id = p_society_id AND status = 'active'
  ) THEN RAISE EXCEPTION 'SOCIETY_SUSPENDED'; END IF;

  IF p_role NOT IN ('resident', 'treasurer') THEN
    RAISE EXCEPTION 'ROLE_NOT_INVITABLE';
  END IF;

  IF (p_role = 'resident') <> (p_unit_id IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_ROLE_UNIT';
  END IF;

  IF p_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.units
    WHERE id = p_unit_id AND society_id = p_society_id
  ) THEN RAISE EXCEPTION 'UNIT_NOT_IN_SOCIETY'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_society_id::text || ':' || lower(trim(p_email)), 0)
  );

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

  IF FOUND THEN
    UPDATE public.resident_invites SET
      email = lower(trim(p_email)), role = p_role, unit_id = p_unit_id,
      invited_by = p_actor_id, created_at = now(), claimed_at = NULL,
      claimed_by = NULL, revoked_at = NULL, revoked_by = NULL
    WHERE id = v_existing.id
    RETURNING id INTO v_invite_id;
  ELSE
    INSERT INTO public.resident_invites (society_id, email, role, unit_id, invited_by)
    VALUES (p_society_id, lower(trim(p_email)), p_role, p_unit_id, p_actor_id)
    RETURNING id INTO v_invite_id;
  END IF;

  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES ('INSERT', 'resident_invites', v_invite_id::text,
    jsonb_build_object('role', p_role, 'unit_id', p_unit_id),
    p_actor_id::text, p_society_id, 'Access authorization created');

  RETURN v_invite_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_access_invite(uuid, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_access_invite(uuid, text, text, uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
