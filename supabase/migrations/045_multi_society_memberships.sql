-- Multi society memberships.

ALTER TABLE public.societies
  ADD COLUMN IF NOT EXISTS short_name text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS primary_contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS legacy_storage_layout text;

ALTER TABLE public.societies DROP CONSTRAINT IF EXISTS societies_status_check;
ALTER TABLE public.societies ADD CONSTRAINT societies_status_check
  CHECK (status IN ('active', 'suspended'));
ALTER TABLE public.societies DROP CONSTRAINT IF EXISTS societies_legacy_storage_layout_check;
ALTER TABLE public.societies ADD CONSTRAINT societies_legacy_storage_layout_check
  CHECK (legacy_storage_layout IS NULL OR legacy_storage_layout = 'unscoped-v1');
UPDATE public.societies SET status = CASE WHEN is_active THEN 'active' ELSE 'suspended' END;

DO $$
DECLARE v_duplicates text;
BEGIN
  SELECT string_agg(society_id::text || ':' || normalized_email, ', ')
  INTO v_duplicates
  FROM (
    SELECT society_id, lower(trim(email)) AS normalized_email
    FROM public.resident_invites
    GROUP BY society_id, lower(trim(email))
    HAVING count(*) > 1
  ) duplicates;
  IF v_duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate normalized resident invitations require reconciliation: %', v_duplicates;
  END IF;
END $$;

UPDATE public.resident_invites SET email = lower(trim(email));
CREATE UNIQUE INDEX IF NOT EXISTS resident_invites_society_normalized_email_key
  ON public.resident_invites(society_id, lower(email));

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE IF NOT EXISTS public.platform_owners (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.society_memberships (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id),
  role text NOT NULL CHECK (role IN ('admin', 'treasurer', 'committee', 'auditor', 'resident')),
  unit_id uuid REFERENCES public.units(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, society_id),
  CHECK ((role = 'resident' AND unit_id IS NOT NULL) OR (role <> 'resident' AND unit_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_active
  ON public.society_memberships(user_id, status, society_id);
CREATE INDEX IF NOT EXISTS idx_memberships_society_active
  ON public.society_memberships(society_id, status, role);

INSERT INTO public.society_memberships (user_id, society_id, role, unit_id)
SELECT id, society_id, role, unit_id FROM public.profiles
ON CONFLICT (user_id, society_id) DO UPDATE
SET role = EXCLUDED.role, unit_id = EXCLUDED.unit_id, status = 'active',
    revoked_at = NULL, revoked_by = NULL, updated_at = now();

-- Cutover invariant: this migration derives memberships from profiles (above), so an
-- existing deployment must come out of it with an Admin in every active society.
-- Scoped to a database that actually produced memberships: on an empty one (fresh
-- install, disaster recovery, the disposable database `npm run test:rls` builds) the
-- backfill yields nothing and the society migration 030 seeds has no members yet —
-- there is no cutover to validate, and the unscoped check made a from-scratch rebuild
-- impossible. The Platform Owner bootstrap grants that Admin membership later.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.society_memberships)
    AND EXISTS (
    SELECT 1 FROM public.societies s
    WHERE s.status = 'active' AND NOT EXISTS (
      SELECT 1 FROM public.society_memberships m
      WHERE m.society_id = s.id AND m.role = 'admin' AND m.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'Every active society requires an active Admin membership';
  END IF;
END $$;

ALTER TABLE public.platform_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.society_memberships ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.auth_is_platform_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.platform_owners po WHERE po.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.auth_membership_role(p_society_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.role FROM public.society_memberships m
  JOIN public.societies s ON s.id = m.society_id
  WHERE m.user_id = (SELECT auth.uid()) AND m.society_id = p_society_id
    AND m.status = 'active' AND s.status = 'active'
    AND s.slug = COALESCE(
      (NULLIF(current_setting('request.headers', true), '')::jsonb ->> 'x-society-slug'),
      ''
    );
$$;

CREATE OR REPLACE FUNCTION private.auth_membership_unit(p_society_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.unit_id FROM public.society_memberships m
  JOIN public.societies s ON s.id = m.society_id
  WHERE m.user_id = (SELECT auth.uid()) AND m.society_id = p_society_id
    AND m.status = 'active' AND s.status = 'active'
    AND s.slug = COALESCE(
      (NULLIF(current_setting('request.headers', true), '')::jsonb ->> 'x-society-slug'),
      ''
    );
$$;

CREATE OR REPLACE FUNCTION private.auth_society_admin(p_society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.auth_membership_role(p_society_id) = 'admin';
$$;

CREATE OR REPLACE FUNCTION private.auth_society_finance(p_society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.auth_membership_role(p_society_id) IN ('admin', 'treasurer');
$$;

CREATE OR REPLACE FUNCTION private.auth_society_read(p_society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.auth_membership_role(p_society_id) IN ('admin', 'treasurer');
$$;

CREATE OR REPLACE FUNCTION private.auth_platform_suspended_read(p_society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.auth_is_platform_owner() AND EXISTS (
    SELECT 1 FROM public.societies s
    JOIN public.society_memberships m ON m.society_id = s.id
    WHERE s.id = p_society_id AND s.status = 'suspended'
      AND m.user_id = (SELECT auth.uid()) AND m.role = 'admin' AND m.status = 'active'
      AND s.slug = COALESCE(
        (NULLIF(current_setting('request.headers', true), '')::jsonb ->> 'x-society-slug'),
        ''
      )
  );
$$;

REVOKE ALL ON FUNCTION private.auth_is_platform_owner() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.auth_membership_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.auth_membership_unit(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.auth_society_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.auth_society_finance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.auth_society_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.auth_platform_suspended_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.auth_is_platform_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION private.auth_membership_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.auth_membership_unit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.auth_society_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.auth_society_finance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.auth_society_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.auth_platform_suspended_read(uuid) TO authenticated;

CREATE POLICY platform_owners_select_own ON public.platform_owners
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY memberships_select ON public.society_memberships
  FOR SELECT TO authenticated USING (
    user_id = (SELECT auth.uid()) OR private.auth_society_admin(society_id)
    OR private.auth_is_platform_owner()
  );
CREATE POLICY societies_member_select ON public.societies
  FOR SELECT TO authenticated USING (
    private.auth_is_platform_owner() OR EXISTS (
      SELECT 1 FROM public.society_memberships m
      WHERE m.society_id = societies.id AND m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
    )
  );

CREATE OR REPLACE FUNCTION public.create_platform_society(
  p_payload jsonb, p_actor_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_society_id uuid;
  v_slug text := lower(trim(p_payload->>'slug'));
  v_name text := trim(p_payload->>'name');
  v_short text := nullif(trim(p_payload->>'short_name'), '');
  v_unit jsonb;
  v_email text;
  v_monthly numeric;
  v_penalty numeric;
  v_window integer;
  v_area numeric;
  v_unit_amount numeric;
  v_admin_authorizations jsonb := '[]'::jsonb;
BEGIN
  IF p_actor_id <> (SELECT auth.uid()) OR NOT private.auth_is_platform_owner() THEN
    RAISE EXCEPTION 'PLATFORM_OWNER_REQUIRED';
  END IF;
  IF length(v_name) NOT BETWEEN 2 AND 150
    OR v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$'
    OR (v_short IS NOT NULL AND length(v_short) NOT BETWEEN 2 AND 20)
  THEN
    RAISE EXCEPTION 'INVALID_SOCIETY_IDENTITY';
  END IF;
  IF nullif(trim(p_payload->>'contact_email'), '') IS NOT NULL
    AND lower(trim(p_payload->>'contact_email')) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  THEN RAISE EXCEPTION 'INVALID_CONTACT_EMAIL'; END IF;
  IF upper(trim(p_payload->>'receipt_prefix')) !~ '^[A-Z0-9-]{2,20}$' THEN
    RAISE EXCEPTION 'INVALID_RECEIPT_PREFIX';
  END IF;
  BEGIN
    v_monthly := (p_payload->>'monthly_maintenance_amount')::numeric;
    v_penalty := (p_payload->>'penalty_rate_percent')::numeric;
    v_window := (p_payload->>'maintenance_payment_window_days')::integer;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'INVALID_BILLING_CONFIGURATION';
  END;
  IF v_monthly < 0 OR v_monthly > 1000000
    OR v_penalty < 0 OR v_penalty > 100
    OR v_window NOT BETWEEN 1 AND 365
  THEN RAISE EXCEPTION 'INVALID_BILLING_CONFIGURATION'; END IF;
  IF jsonb_typeof(COALESCE(p_payload->'units', '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_payload->'units', '[]'::jsonb)) NOT BETWEEN 1 AND 2000
  THEN
    RAISE EXCEPTION 'AT_LEAST_ONE_UNIT_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload->'units') AS item(value)
    GROUP BY lower(trim(value->>'flat_number')) HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'DUPLICATE_FLAT_NUMBER'; END IF;
  IF jsonb_typeof(COALESCE(p_payload->'initial_admin_emails', '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_payload->'initial_admin_emails', '[]'::jsonb)) > 20
  THEN RAISE EXCEPTION 'INVALID_ADMIN_EMAILS'; END IF;

  INSERT INTO public.societies (
    name, slug, short_name, address, primary_contact_name, contact_phone, contact_email, is_active, status
  ) VALUES (
    v_name, v_slug, v_short, nullif(trim(p_payload->>'address'), ''),
    nullif(trim(p_payload->>'primary_contact_name'), ''),
    nullif(trim(p_payload->>'contact_phone'), ''),
    nullif(lower(trim(p_payload->>'contact_email')), ''), true, 'active'
  ) RETURNING id INTO v_society_id;

  INSERT INTO public.society_config (
    society_id, name, address, mobile, bank_name, bank_account_no, bank_ifsc, upi_id,
    receipt_prefix, next_receipt_no, monthly_maintenance_amount, penalty_rate_percent,
    maintenance_payment_window_days, financial_year_start_month,
    dues_notice_title, dues_notice_payby_days, dues_notice_footer
  ) VALUES (
    v_society_id, v_name, nullif(trim(p_payload->>'address'), ''),
    nullif(trim(p_payload->>'contact_phone'), ''), nullif(trim(p_payload->>'bank_name'), ''),
    nullif(trim(p_payload->>'bank_account_no'), ''), nullif(upper(trim(p_payload->>'bank_ifsc')), ''),
    nullif(trim(p_payload->>'upi_id'), ''), upper(trim(p_payload->>'receipt_prefix')), 1,
    v_monthly, v_penalty, v_window, 4,
    'Maintenance Dues Reminder', 7,
    'Please clear the outstanding dues by the date shown above. Contact the treasurer for any discrepancy.'
  );

  FOR v_unit IN SELECT value FROM jsonb_array_elements(p_payload->'units') LOOP
    IF length(trim(v_unit->>'flat_number')) NOT BETWEEN 1 AND 30 THEN
      RAISE EXCEPTION 'INVALID_FLAT_NUMBER';
    END IF;
    BEGIN
      v_area := nullif(v_unit->>'flat_area_sqft', '')::numeric;
      v_unit_amount := nullif(v_unit->>'monthly_amount', '')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'INVALID_UNIT_CONFIGURATION';
    END;
    IF (v_area IS NOT NULL AND (v_area <= 0 OR v_area > 1000000))
      OR (v_unit_amount IS NOT NULL AND (v_unit_amount < 0 OR v_unit_amount > 1000000))
    THEN RAISE EXCEPTION 'INVALID_UNIT_CONFIGURATION'; END IF;
    INSERT INTO public.units (society_id, flat_number, flat_area_sqft, monthly_amount, is_active, is_test_unit)
    VALUES (
      v_society_id, trim(v_unit->>'flat_number'), v_area, v_unit_amount, true, false
    );
  END LOOP;

  INSERT INTO public.society_memberships (user_id, society_id, role, unit_id)
  VALUES (p_actor_id, v_society_id, 'admin', NULL);

  FOR v_email IN SELECT lower(trim(value #>> '{}'))
    FROM jsonb_array_elements(COALESCE(p_payload->'initial_admin_emails', '[]'::jsonb))
  LOOP
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'INVALID_ADMIN_EMAIL'; END IF;
    INSERT INTO public.resident_invites (society_id, email, role, unit_id, invited_by)
    VALUES (v_society_id, v_email, 'admin', NULL, p_actor_id);
    v_admin_authorizations := v_admin_authorizations || jsonb_build_array(v_email);
  END LOOP;

  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES ('INSERT', 'societies', v_society_id::text,
    jsonb_build_object('slug', v_slug, 'unit_count', jsonb_array_length(p_payload->'units')),
    p_actor_id::text, v_society_id, 'Society created by Platform Owner');

  RETURN jsonb_build_object(
    'id', v_society_id,
    'slug', v_slug,
    'admin_authorizations', v_admin_authorizations
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_society_suspension(
  p_society_id uuid, p_suspended boolean, p_reason text, p_actor_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_actor_id <> (SELECT auth.uid()) OR NOT private.auth_is_platform_owner() THEN
    RAISE EXCEPTION 'PLATFORM_OWNER_REQUIRED';
  END IF;
  IF length(trim(p_reason)) < 10 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  UPDATE public.societies SET
    status = CASE WHEN p_suspended THEN 'suspended' ELSE 'active' END,
    is_active = NOT p_suspended,
    suspended_at = CASE WHEN p_suspended THEN now() ELSE NULL END,
    suspended_by = CASE WHEN p_suspended THEN p_actor_id ELSE NULL END,
    suspension_reason = CASE WHEN p_suspended THEN trim(p_reason) ELSE NULL END
  WHERE id = p_society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOCIETY_NOT_FOUND'; END IF;
  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES ('UPDATE', 'societies', p_society_id::text,
    jsonb_build_object('status', CASE WHEN p_suspended THEN 'suspended' ELSE 'active' END),
    p_actor_id::text, p_society_id,
    CASE WHEN p_suspended THEN 'Society suspended: ' || trim(p_reason) ELSE 'Society reactivated: ' || trim(p_reason) END);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.create_platform_society(jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_society_suspension(uuid, boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_platform_society(jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_society_suspension(uuid, boolean, text, uuid) TO authenticated;

-- One-time deployment bootstrap. Call with the already verified auth user UUID,
-- then revoke service access after production has its sole Platform Owner.
CREATE OR REPLACE FUNCTION public.bootstrap_platform_owner(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'AUTH_USER_NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_owners WHERE user_id <> p_user_id) THEN
    RAISE EXCEPTION 'PLATFORM_OWNER_ALREADY_CONFIGURED';
  END IF;
  INSERT INTO public.platform_owners(user_id) VALUES (p_user_id) ON CONFLICT DO NOTHING;
  INSERT INTO public.society_memberships (user_id, society_id, role, unit_id)
  SELECT p_user_id, id, 'admin', NULL FROM public.societies
  ON CONFLICT (user_id, society_id) DO UPDATE SET
    role = 'admin', unit_id = NULL, status = 'active', revoked_at = NULL,
    revoked_by = NULL, updated_at = now();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_platform_owner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_platform_owner(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.bootstrap_platform_owner_by_email(p_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user_id uuid; v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF v_count <> 1 THEN RAISE EXCEPTION 'PLATFORM_OWNER_IDENTITY_NOT_UNIQUE'; END IF;
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(trim(p_email));
  RETURN public.bootstrap_platform_owner(v_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_platform_owner_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_platform_owner_by_email(text) TO service_role;
