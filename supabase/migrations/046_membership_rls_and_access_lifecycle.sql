-- Membership rls and access lifecycle.

ALTER TABLE public.resident_invites
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id);

-- Tenant identity must always be supplied by an authenticated application/RPC
ALTER TABLE public.society_config ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.units ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.residents ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.payments ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.bills ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.expenditures ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.other_income ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.balance_snapshots ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.amc_collections ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.treasurer_handovers ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.levy_configs ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.profiles ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.resident_invites ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.opening_balances ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.fund_ledger_entries ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.advance_settlements ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.bank_statement_batches ALTER COLUMN society_id DROP DEFAULT;
ALTER TABLE public.fy_treasurers ALTER COLUMN society_id DROP DEFAULT;

-- Views must execute with the caller's RLS policies rather than the view
-- owner's privileges. Reassert this at the membership cutover boundary.
ALTER VIEW public.v_dues_summary SET (security_invoker = true);
ALTER VIEW public.v_monthly_collections SET (security_invoker = true);
ALTER VIEW public.v_monthly_expenditures SET (security_invoker = true);

CREATE OR REPLACE FUNCTION public.get_community_dues()
RETURNS TABLE(flat_number text, total_due numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.flat_number,
    COALESCE(SUM(
      CASE
        WHEN b.status = 'OVERDUE' THEN b.payable_amount
        WHEN b.status = 'ISSUED' AND b.due_date < CURRENT_DATE THEN b.payable_amount
        ELSE 0
      END
    ), 0)::numeric AS total_due
  FROM public.societies s
  JOIN public.units u
    ON u.society_id = s.id
   AND u.is_active = true
   AND u.is_test_unit = false
  LEFT JOIN public.bills b
    ON b.unit_id = u.id
   AND b.society_id = s.id
   AND b.is_voided = false
   AND b.status IN ('OVERDUE', 'ISSUED')
  WHERE s.slug = (NULLIF(current_setting('request.headers', true), '')::jsonb ->> 'x-society-slug')
    AND (
      private.auth_membership_role(s.id) IN ('admin', 'treasurer', 'resident')
      OR private.auth_platform_suspended_read(s.id)
    )
  GROUP BY u.id, u.flat_number
  ORDER BY u.flat_number;
$$;

REVOKE ALL ON FUNCTION public.get_community_dues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_dues() TO authenticated;

-- Public privacy details are selected by immutable society slug. An omitted or
-- invalid slug returns no row instead of leaking whichever tenant sorts first.
DROP FUNCTION IF EXISTS public.get_public_privacy_contact();
CREATE FUNCTION public.get_public_privacy_contact(p_society_slug text)
RETURNS TABLE(name text, address text, mobile text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.name, c.address, c.mobile
  FROM public.society_config c
  JOIN public.societies s ON s.id = c.society_id
  WHERE s.slug = lower(trim(p_society_slug))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_privacy_contact(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_privacy_contact(text) TO anon, authenticated;

ALTER TABLE public.units ADD CONSTRAINT units_id_society_unique UNIQUE (id, society_id);
ALTER TABLE public.residents ADD CONSTRAINT residents_id_society_unique UNIQUE (id, society_id);
ALTER TABLE public.residents ADD CONSTRAINT residents_unit_same_society
  FOREIGN KEY (unit_id, society_id) REFERENCES public.units(id, society_id);
ALTER TABLE public.payments ADD CONSTRAINT payments_unit_same_society
  FOREIGN KEY (unit_id, society_id) REFERENCES public.units(id, society_id);
ALTER TABLE public.payments ADD CONSTRAINT payments_resident_same_society
  FOREIGN KEY (resident_id, society_id) REFERENCES public.residents(id, society_id);
ALTER TABLE public.bills ADD CONSTRAINT bills_unit_same_society
  FOREIGN KEY (unit_id, society_id) REFERENCES public.units(id, society_id);
ALTER TABLE public.amc_collections ADD CONSTRAINT amc_unit_same_society
  FOREIGN KEY (unit_id, society_id) REFERENCES public.units(id, society_id);
ALTER TABLE public.amc_collections ADD CONSTRAINT amc_resident_same_society
  FOREIGN KEY (resident_id, society_id) REFERENCES public.residents(id, society_id);
ALTER TABLE public.society_memberships ADD CONSTRAINT memberships_unit_same_society
  FOREIGN KEY (unit_id, society_id) REFERENCES public.units(id, society_id);
ALTER TABLE public.resident_invites ADD CONSTRAINT invites_unit_same_society
  FOREIGN KEY (unit_id, society_id) REFERENCES public.units(id, society_id);
ALTER TABLE public.access_requests ADD CONSTRAINT requests_unit_same_society
  FOREIGN KEY (unit_id, society_id) REFERENCES public.units(id, society_id);

-- Replace singleton-profile policies with indexed membership checks. Unsupported
-- roles receive no policy and therefore remain denied by default.
DO $policy_cutover$
DECLARE
  v_table text;
  v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'society_config','units','residents','payments','bills','expenditures',
    'other_income','audit_log','balance_snapshots','amc_collections',
    'treasurer_handovers','levy_configs','opening_balances','fund_ledger_entries',
    'advance_settlements','bank_statement_batches','fy_treasurers',
    'resident_invites','access_requests'
  ] LOOP
    FOR v_policy IN SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'payments','bills','expenditures','other_income','balance_snapshots',
    'amc_collections','treasurer_handovers','opening_balances',
    'fund_ledger_entries','advance_settlements','bank_statement_batches'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.auth_society_finance(society_id) OR private.auth_platform_suspended_read(society_id))',
      v_table || '_membership_read', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (private.auth_society_finance(society_id)) WITH CHECK (private.auth_society_finance(society_id))',
      v_table || '_membership_write', v_table
    );
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY['society_config','units','levy_configs','fy_treasurers'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.auth_society_finance(society_id) OR private.auth_platform_suspended_read(society_id))',
      v_table || '_membership_read', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (private.auth_society_admin(society_id)) WITH CHECK (private.auth_society_admin(society_id))',
      v_table || '_admin_write', v_table
    );
  END LOOP;

  CREATE POLICY residents_membership_read ON public.residents FOR SELECT TO authenticated
    USING (private.auth_society_finance(society_id) OR private.auth_platform_suspended_read(society_id));
  CREATE POLICY residents_membership_write ON public.residents FOR ALL TO authenticated
    USING (private.auth_society_finance(society_id)) WITH CHECK (private.auth_society_finance(society_id));
  CREATE POLICY audit_membership_read ON public.audit_log FOR SELECT TO authenticated
    USING (private.auth_society_finance(society_id) OR private.auth_platform_suspended_read(society_id));
  CREATE POLICY audit_membership_insert ON public.audit_log FOR INSERT TO authenticated
    WITH CHECK (private.auth_society_finance(society_id));
  CREATE POLICY invites_admin_read ON public.resident_invites FOR SELECT TO authenticated
    USING (private.auth_society_admin(society_id));
  CREATE POLICY requests_admin_read ON public.access_requests FOR SELECT TO authenticated
    USING (private.auth_society_admin(society_id));

  CREATE POLICY units_resident_own ON public.units FOR SELECT TO authenticated
    USING (id = private.auth_membership_unit(society_id));
  CREATE POLICY payments_resident_own ON public.payments FOR SELECT TO authenticated
    USING (unit_id = private.auth_membership_unit(society_id));
  CREATE POLICY bills_resident_own ON public.bills FOR SELECT TO authenticated
    USING (unit_id = private.auth_membership_unit(society_id));
  CREATE POLICY amc_resident_own ON public.amc_collections FOR SELECT TO authenticated
    USING (unit_id = private.auth_membership_unit(society_id));
  CREATE POLICY levy_configs_resident_read ON public.levy_configs FOR SELECT TO authenticated
    USING (private.auth_membership_unit(society_id) IS NOT NULL);
END
$policy_cutover$;

DO $profile_policies$
DECLARE v_policy record;
BEGIN
  FOR v_policy IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', v_policy.policyname);
  END LOOP;
END
$profile_policies$;
CREATE POLICY profiles_select_self ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

DO $line_policies$
DECLARE v_policy record;
BEGIN
  FOR v_policy IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bank_statement_lines'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.bank_statement_lines', v_policy.policyname);
  END LOOP;
END
$line_policies$;
CREATE POLICY bank_lines_membership_read ON public.bank_statement_lines FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.bank_statement_batches batch
  WHERE batch.id = bank_statement_lines.batch_id
    AND (private.auth_society_finance(batch.society_id) OR private.auth_platform_suspended_read(batch.society_id))
));
CREATE POLICY bank_lines_membership_write ON public.bank_statement_lines FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.bank_statement_batches batch
  WHERE batch.id = bank_statement_lines.batch_id AND private.auth_society_finance(batch.society_id)
)) WITH CHECK (EXISTS (
  SELECT 1 FROM public.bank_statement_batches batch
  WHERE batch.id = bank_statement_lines.batch_id AND private.auth_society_finance(batch.society_id)
));

CREATE OR REPLACE FUNCTION public.set_fy_treasurer_and_backfill(
  p_society_id uuid, p_fy_start_year integer, p_resident_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_name text; v_mapping_id uuid; v_from date; v_to date;
  v_payments integer; v_expenses integer; v_levies integer; v_income integer;
BEGIN
  IF p_society_id IS NULL OR NOT private.auth_society_admin(p_society_id) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_fy_start_year < 2000 OR p_fy_start_year > 2100 THEN RAISE EXCEPTION 'INVALID_FINANCIAL_YEAR'; END IF;
  SELECT full_name INTO v_name FROM public.residents
    WHERE id = p_resident_id AND society_id = p_society_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'RESIDENT_NOT_IN_SOCIETY'; END IF;
  INSERT INTO public.fy_treasurers (society_id, fy_start_year, resident_id)
  VALUES (p_society_id, p_fy_start_year, p_resident_id)
  ON CONFLICT (society_id, fy_start_year) DO UPDATE SET resident_id = EXCLUDED.resident_id
  RETURNING id INTO v_mapping_id;
  v_from := make_date(p_fy_start_year, 4, 1); v_to := make_date(p_fy_start_year + 1, 3, 31);
  UPDATE public.payments SET recorded_by = v_name
    WHERE society_id = p_society_id AND payment_date BETWEEN v_from AND v_to;
  GET DIAGNOSTICS v_payments = ROW_COUNT;
  UPDATE public.expenditures SET recorded_by = v_name
    WHERE society_id = p_society_id AND expense_date BETWEEN v_from AND v_to;
  GET DIAGNOSTICS v_expenses = ROW_COUNT;
  UPDATE public.amc_collections SET recorded_by = v_name
    WHERE society_id = p_society_id AND COALESCE(payment_date, created_at::date) BETWEEN v_from AND v_to;
  GET DIAGNOSTICS v_levies = ROW_COUNT;
  UPDATE public.other_income SET recorded_by = v_name
    WHERE society_id = p_society_id AND income_date BETWEEN v_from AND v_to;
  GET DIAGNOSTICS v_income = ROW_COUNT;
  RETURN jsonb_build_object('id', v_mapping_id, 'fy_start_year', p_fy_start_year,
    'resident_id', p_resident_id, 'updated', jsonb_build_object(
      'payments', v_payments, 'expenses', v_expenses, 'levies', v_levies, 'other_income', v_income));
END;
$$;

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
    IF FOUND AND v_existing.status = 'active'
      AND (v_existing.role <> v_invite.role OR v_existing.unit_id IS DISTINCT FROM v_invite.unit_id) THEN
      RAISE EXCEPTION 'CONFLICTING_MEMBERSHIP';
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

CREATE OR REPLACE FUNCTION public.create_access_invite(
  p_society_id uuid, p_email text, p_role text, p_unit_id uuid, p_actor_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_existing public.resident_invites%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.society_memberships
    WHERE user_id = p_actor_id AND society_id = p_society_id AND role = 'admin' AND status = 'active')
  THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.societies WHERE id = p_society_id AND status = 'active')
  THEN RAISE EXCEPTION 'SOCIETY_SUSPENDED'; END IF;
  IF p_role NOT IN ('resident', 'treasurer') THEN RAISE EXCEPTION 'ROLE_NOT_INVITABLE'; END IF;
  IF (p_role = 'resident') <> (p_unit_id IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_ROLE_UNIT'; END IF;
  IF p_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.units WHERE id = p_unit_id AND society_id = p_society_id
  ) THEN RAISE EXCEPTION 'UNIT_NOT_IN_SOCIETY'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_society_id::text || ':' || lower(trim(p_email)), 0));
  SELECT * INTO v_existing FROM public.resident_invites
    WHERE society_id = p_society_id AND lower(email) = lower(trim(p_email)) FOR UPDATE;
  IF FOUND AND v_existing.revoked_at IS NULL THEN
    IF v_existing.claimed_by IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.society_memberships WHERE user_id = v_existing.claimed_by
        AND society_id = p_society_id AND status = 'active'
    ) THEN RAISE EXCEPTION 'ACTIVE_ACCESS_EXISTS'; END IF;
    IF v_existing.claimed_at IS NULL THEN RAISE EXCEPTION 'PENDING_ACCESS_EXISTS'; END IF;
  END IF;
  IF FOUND THEN
    UPDATE public.resident_invites SET email = lower(trim(p_email)), role = p_role,
      unit_id = p_unit_id, invited_by = p_actor_id, created_at = now(),
      claimed_at = NULL, claimed_by = NULL, revoked_at = NULL, revoked_by = NULL
    WHERE id = v_existing.id RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.resident_invites (society_id, email, role, unit_id, invited_by)
    VALUES (p_society_id, lower(trim(p_email)), p_role, p_unit_id, p_actor_id) RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES ('INSERT', 'resident_invites', v_id::text,
    jsonb_build_object('role', p_role, 'unit_id', p_unit_id), p_actor_id::text,
    p_society_id, 'Access authorized');
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_access_request(
  p_society_id uuid, p_unit_id uuid, p_email text, p_name text, p_phone text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_resubmitted boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.societies WHERE id = p_society_id AND status = 'active')
    OR NOT EXISTS (SELECT 1 FROM public.units WHERE id = p_unit_id AND society_id = p_society_id AND is_active)
  THEN RAISE EXCEPTION 'INVALID_SOCIETY_OR_UNIT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_society_id::text || ':' || lower(trim(p_email)), 0));
  UPDATE public.access_requests SET unit_id = p_unit_id,
    submitted_name = nullif(trim(p_name), ''), submitted_phone = nullif(trim(p_phone), ''), created_at = now()
  WHERE id = (SELECT id FROM public.access_requests WHERE society_id = p_society_id
    AND lower(email) = lower(trim(p_email)) AND status = 'PENDING' LIMIT 1)
  RETURNING id INTO v_id;
  v_resubmitted := v_id IS NOT NULL;
  IF v_id IS NULL THEN
    INSERT INTO public.access_requests (society_id, unit_id, email, submitted_name, submitted_phone)
    VALUES (p_society_id, p_unit_id, lower(trim(p_email)), nullif(trim(p_name), ''), nullif(trim(p_phone), ''))
    RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES (CASE WHEN v_resubmitted THEN 'UPDATE'::public.audit_action ELSE 'INSERT'::public.audit_action END,
    'access_requests', v_id::text, jsonb_build_object('unit_id', p_unit_id),
    'public-access-request', p_society_id,
    CASE WHEN v_resubmitted THEN 'Resident access request resubmitted' ELSE 'Resident access requested' END);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_access_request(
  p_request_id uuid, p_action text, p_reason text, p_society_id uuid, p_actor_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_request public.access_requests%ROWTYPE; v_invite public.resident_invites%ROWTYPE;
  v_invite_id uuid; v_user_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.society_memberships
    WHERE user_id = p_actor_id AND society_id = p_society_id AND role = 'admin' AND status = 'active')
  THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_action NOT IN ('approve', 'decline') THEN RAISE EXCEPTION 'INVALID_DECISION'; END IF;
  SELECT * INTO v_request FROM public.access_requests
    WHERE id = p_request_id AND society_id = p_society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF v_request.status <> 'PENDING' THEN RAISE EXCEPTION 'REQUEST_ALREADY_HANDLED'; END IF;
  IF p_action = 'approve' THEN
    SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_request.email);
    IF v_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.society_memberships
      WHERE user_id = v_user_id AND society_id = p_society_id AND status = 'active')
    THEN RAISE EXCEPTION 'ACTIVE_ACCESS_EXISTS'; END IF;
    SELECT * INTO v_invite FROM public.resident_invites
      WHERE society_id = p_society_id AND lower(email) = lower(v_request.email) FOR UPDATE;
    IF FOUND AND v_invite.revoked_at IS NULL AND v_invite.role <> 'resident' THEN
      RAISE EXCEPTION 'CONFLICTING_ACCESS_EXISTS';
    END IF;
    IF FOUND THEN
      UPDATE public.resident_invites SET role = 'resident', unit_id = v_request.unit_id,
        invited_by = p_actor_id, revoked_at = NULL, revoked_by = NULL,
        claimed_at = CASE WHEN v_user_id IS NOT NULL THEN now() ELSE NULL END,
        claimed_by = v_user_id
      WHERE id = v_invite.id RETURNING id INTO v_invite_id;
    ELSE
      INSERT INTO public.resident_invites (society_id, email, role, unit_id, invited_by, claimed_at, claimed_by)
      VALUES (p_society_id, lower(v_request.email), 'resident', v_request.unit_id, p_actor_id,
        CASE WHEN v_user_id IS NOT NULL THEN now() ELSE NULL END, v_user_id)
      RETURNING id INTO v_invite_id;
    END IF;
    IF v_user_id IS NOT NULL THEN
      INSERT INTO public.society_memberships (user_id, society_id, role, unit_id, status)
      VALUES (v_user_id, p_society_id, 'resident', v_request.unit_id, 'active')
      ON CONFLICT (user_id, society_id) DO UPDATE SET role = 'resident', unit_id = EXCLUDED.unit_id,
        status = 'active', revoked_at = NULL, revoked_by = NULL, updated_at = now();
    END IF;
  END IF;
  UPDATE public.access_requests SET status = CASE WHEN p_action = 'approve' THEN 'APPROVED' ELSE 'DECLINED' END,
    decline_reason = CASE WHEN p_action = 'decline' THEN nullif(trim(p_reason), '') ELSE NULL END,
    decided_by = p_actor_id, decided_at = now() WHERE id = p_request_id;
  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES ('UPDATE', 'access_requests', p_request_id::text,
    jsonb_build_object('decision', p_action, 'invite_id', v_invite_id),
    p_actor_id::text, p_society_id, 'Access request decided');
  RETURN v_invite_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_platform_admin_authorization(
  p_society_id uuid, p_email text, p_actor_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_existing public.resident_invites%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_owners WHERE user_id = p_actor_id)
    OR NOT EXISTS (SELECT 1 FROM public.society_memberships
      WHERE user_id = p_actor_id AND society_id = p_society_id
        AND role = 'admin' AND status = 'active')
  THEN RAISE EXCEPTION 'PLATFORM_OWNER_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.societies WHERE id = p_society_id AND status = 'active')
  THEN RAISE EXCEPTION 'SOCIETY_SUSPENDED'; END IF;
  IF lower(trim(p_email)) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  THEN RAISE EXCEPTION 'INVALID_ADMIN_EMAIL'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_society_id::text || ':' || lower(trim(p_email)), 0));
  SELECT * INTO v_existing FROM public.resident_invites
    WHERE society_id = p_society_id AND lower(email) = lower(trim(p_email)) FOR UPDATE;
  IF FOUND AND v_existing.revoked_at IS NULL THEN
    IF v_existing.claimed_by IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.society_memberships
      WHERE user_id = v_existing.claimed_by AND society_id = p_society_id AND status = 'active'
    ) THEN RAISE EXCEPTION 'ACTIVE_ACCESS_EXISTS'; END IF;
    IF v_existing.claimed_at IS NULL THEN RAISE EXCEPTION 'PENDING_ACCESS_EXISTS'; END IF;
  END IF;

  IF FOUND THEN
    UPDATE public.resident_invites SET email = lower(trim(p_email)), role = 'admin',
      unit_id = NULL, invited_by = p_actor_id, created_at = now(), claimed_at = NULL,
      claimed_by = NULL, revoked_at = NULL, revoked_by = NULL
    WHERE id = v_existing.id RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.resident_invites (society_id, email, role, unit_id, invited_by)
    VALUES (p_society_id, lower(trim(p_email)), 'admin', NULL, p_actor_id)
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.audit_log (action, table_name, record_id, new_data, performed_by, society_id, notes)
  VALUES ('INSERT', 'resident_invites', v_id::text, jsonb_build_object('role', 'admin'),
    p_actor_id::text, p_society_id, 'Platform Admin access authorized');
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_access_invite(
  p_invite_id uuid, p_society_id uuid, p_actor_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_invite public.resident_invites%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.society_memberships
    WHERE user_id = p_actor_id AND society_id = p_society_id AND role = 'admin' AND status = 'active') THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  SELECT * INTO v_invite FROM public.resident_invites
    WHERE id = p_invite_id AND society_id = p_society_id AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_invite.role = 'admin'
    AND NOT EXISTS (SELECT 1 FROM public.platform_owners WHERE user_id = p_actor_id)
  THEN RAISE EXCEPTION 'PLATFORM_OWNER_REQUIRED'; END IF;
  IF v_invite.claimed_by IS NOT NULL THEN
    UPDATE public.society_memberships SET status = 'revoked', revoked_at = now(),
      revoked_by = p_actor_id, updated_at = now()
    WHERE user_id = v_invite.claimed_by AND society_id = p_society_id AND status = 'active';
  END IF;
  UPDATE public.resident_invites SET revoked_at = now(), revoked_by = p_actor_id WHERE id = p_invite_id;
  INSERT INTO public.audit_log (action, table_name, record_id, performed_by, society_id, notes)
  VALUES ('UPDATE', 'resident_invites', p_invite_id::text, p_actor_id::text, p_society_id, 'Society membership revoked');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_required_admin_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.role = 'admin' AND OLD.status = 'active'
    AND (TG_OP = 'DELETE' OR NEW.status <> 'active' OR NEW.role <> 'admin') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.society_id::text, 0));
    IF EXISTS (SELECT 1 FROM public.platform_owners WHERE user_id = OLD.user_id) THEN
      RAISE EXCEPTION 'PLATFORM_OWNER_ADMIN_REQUIRED';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.society_memberships
      WHERE society_id = OLD.society_id AND role = 'admin' AND status = 'active' AND id <> OLD.id
    ) THEN RAISE EXCEPTION 'FINAL_ADMIN_REQUIRED'; END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS protect_required_admin_membership ON public.society_memberships;
CREATE TRIGGER protect_required_admin_membership
BEFORE UPDATE OR DELETE ON public.society_memberships
FOR EACH ROW EXECUTE FUNCTION public.protect_required_admin_membership();

REVOKE ALL ON FUNCTION public.claim_access_authorizations(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_access_invite(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_access_request(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_access_request(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_platform_admin_authorization(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_access_invite(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_access_authorizations(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_access_invite(uuid, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_access_request(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_access_request(uuid, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_platform_admin_authorization(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_access_invite(uuid, uuid, uuid) TO service_role;
