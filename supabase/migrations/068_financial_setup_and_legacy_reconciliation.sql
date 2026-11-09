-- Financial setup and legacy reconciliation.

CREATE OR REPLACE FUNCTION public.update_financial_setup(
  p_society_id uuid,
  p_monthly_maintenance_amount numeric,
  p_maintenance_payment_window_days integer,
  p_penalty_rate_percent numeric,
  p_bank_name text,
  p_bank_account_no text,
  p_bank_ifsc text,
  p_upi_id text,
  p_dues_notice_title text,
  p_dues_notice_payby_days integer,
  p_dues_notice_footer text
)
RETURNS public.society_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_old public.society_config;
  v_new public.society_config;
BEGIN
  IF p_society_id IS NULL OR v_actor IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_monthly_maintenance_amount IS NULL
    OR p_monthly_maintenance_amount < 0 OR p_monthly_maintenance_amount > 1000000
    OR p_monthly_maintenance_amount::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_maintenance_payment_window_days IS NULL
    OR p_maintenance_payment_window_days NOT BETWEEN 0 AND 365
    OR p_penalty_rate_percent IS NULL
    OR p_penalty_rate_percent NOT BETWEEN 0 AND 100
    OR p_penalty_rate_percent::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_dues_notice_payby_days IS NULL
    OR p_dues_notice_payby_days NOT BETWEEN 0 AND 365
    OR length(trim(COALESCE(p_bank_name, ''))) > 150
    OR length(trim(COALESCE(p_bank_account_no, ''))) > 50
    OR length(trim(COALESCE(p_bank_ifsc, ''))) > 20
    OR length(trim(COALESCE(p_upi_id, ''))) > 100
    OR length(trim(COALESCE(p_dues_notice_title, ''))) NOT BETWEEN 2 AND 160
    OR length(COALESCE(p_dues_notice_footer, '')) > 2000
  THEN
    RAISE EXCEPTION 'INVALID_FINANCIAL_SETUP';
  END IF;

  SELECT * INTO v_old FROM public.society_config
  WHERE society_id = p_society_id FOR UPDATE;

  IF FOUND THEN
    UPDATE public.society_config SET
      monthly_maintenance_amount = p_monthly_maintenance_amount,
      maintenance_payment_window_days = p_maintenance_payment_window_days,
      penalty_rate_percent = p_penalty_rate_percent,
      bank_name = NULLIF(trim(p_bank_name), ''),
      bank_account_no = NULLIF(trim(p_bank_account_no), ''),
      bank_ifsc = NULLIF(upper(trim(p_bank_ifsc)), ''),
      upi_id = NULLIF(trim(p_upi_id), ''),
      dues_notice_title = trim(p_dues_notice_title),
      dues_notice_payby_days = p_dues_notice_payby_days,
      dues_notice_footer = trim(COALESCE(p_dues_notice_footer, '')),
      updated_at = now()
    WHERE society_id = p_society_id
    RETURNING * INTO v_new;
  ELSE
    INSERT INTO public.society_config (
      society_id, name, monthly_maintenance_amount,
      maintenance_payment_window_days, penalty_rate_percent,
      bank_name, bank_account_no, bank_ifsc, upi_id,
      dues_notice_title, dues_notice_payby_days, dues_notice_footer
    )
    SELECT s.id, s.name, p_monthly_maintenance_amount,
      p_maintenance_payment_window_days, p_penalty_rate_percent,
      NULLIF(trim(p_bank_name), ''), NULLIF(trim(p_bank_account_no), ''),
      NULLIF(upper(trim(p_bank_ifsc)), ''), NULLIF(trim(p_upi_id), ''),
      trim(p_dues_notice_title), p_dues_notice_payby_days,
      trim(COALESCE(p_dues_notice_footer, ''))
    FROM public.societies s WHERE s.id = p_society_id
    RETURNING * INTO v_new;
    IF v_new.id IS NULL THEN RAISE EXCEPTION 'SOCIETY_NOT_FOUND'; END IF;
  END IF;

  INSERT INTO public.audit_log (
    action, table_name, record_id, old_data, new_data,
    performed_by, society_id, notes
  ) VALUES (
    CASE WHEN v_old.id IS NULL THEN 'INSERT'::public.audit_action ELSE 'UPDATE'::public.audit_action END,
    'society_config', v_new.id::text,
    CASE WHEN v_old.id IS NULL THEN NULL ELSE jsonb_build_object(
      'monthly_maintenance_amount', v_old.monthly_maintenance_amount,
      'maintenance_payment_window_days', v_old.maintenance_payment_window_days,
      'penalty_rate_percent', v_old.penalty_rate_percent,
      'bank_name', v_old.bank_name, 'bank_account_no', v_old.bank_account_no,
      'bank_ifsc', v_old.bank_ifsc, 'upi_id', v_old.upi_id,
      'dues_notice_title', v_old.dues_notice_title,
      'dues_notice_payby_days', v_old.dues_notice_payby_days,
      'dues_notice_footer', v_old.dues_notice_footer
    ) END,
    jsonb_build_object(
      'monthly_maintenance_amount', v_new.monthly_maintenance_amount,
      'maintenance_payment_window_days', v_new.maintenance_payment_window_days,
      'penalty_rate_percent', v_new.penalty_rate_percent,
      'bank_name', v_new.bank_name, 'bank_account_no', v_new.bank_account_no,
      'bank_ifsc', v_new.bank_ifsc, 'upi_id', v_new.upi_id,
      'dues_notice_title', v_new.dues_notice_title,
      'dues_notice_payby_days', v_new.dues_notice_payby_days,
      'dues_notice_footer', v_new.dues_notice_footer
    ),
    v_actor::text, p_society_id, 'Financial setup updated'
  );

  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_financial_setup_qr(
  p_society_id uuid,
  p_object_key text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_config_id uuid;
  v_old_key text;
  v_new_key text := NULLIF(trim(p_object_key), '');
BEGIN
  IF p_society_id IS NULL OR v_actor IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_new_key IS NOT NULL AND (
    length(v_new_key) > 1000
    OR v_new_key NOT LIKE ('societies/' || p_society_id::text || '/%')
  ) THEN RAISE EXCEPTION 'INVALID_QR_KEY'; END IF;

  SELECT id, upi_qr_object_key INTO v_config_id, v_old_key
  FROM public.society_config WHERE society_id = p_society_id FOR UPDATE;

  IF v_config_id IS NULL THEN
    INSERT INTO public.society_config (society_id, name, upi_qr_object_key)
    SELECT id, name, v_new_key FROM public.societies WHERE id = p_society_id
    RETURNING id, upi_qr_object_key INTO v_config_id, v_new_key;
    IF v_config_id IS NULL THEN RAISE EXCEPTION 'SOCIETY_NOT_FOUND'; END IF;
  ELSE
    UPDATE public.society_config
      SET upi_qr_object_key = v_new_key, updated_at = now()
      WHERE id = v_config_id;
  END IF;

  INSERT INTO public.audit_log (
    action, table_name, record_id, old_data, new_data,
    performed_by, society_id, notes
  ) VALUES (
    'UPDATE', 'society_config', v_config_id::text,
    jsonb_build_object('upi_qr_object_key', v_old_key),
    jsonb_build_object('upi_qr_object_key', v_new_key),
    v_actor::text, p_society_id, 'Payment QR reference updated'
  );
  RETURN v_old_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_unit_monthly_amount(
  p_society_id uuid,
  p_unit_id uuid,
  p_monthly_amount numeric
)
RETURNS public.units
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_old_amount numeric;
  v_unit public.units;
BEGIN
  IF p_society_id IS NULL OR p_unit_id IS NULL OR v_actor IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_monthly_amount IS NOT NULL
    AND (p_monthly_amount < 0 OR p_monthly_amount > 1000000
      OR p_monthly_amount::text IN ('NaN', 'Infinity', '-Infinity'))
  THEN RAISE EXCEPTION 'INVALID_MONTHLY_AMOUNT'; END IF;

  SELECT monthly_amount INTO v_old_amount FROM public.units
  WHERE id = p_unit_id AND society_id = p_society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNIT_NOT_FOUND'; END IF;

  UPDATE public.units SET monthly_amount = p_monthly_amount, updated_at = now()
  WHERE id = p_unit_id
  RETURNING * INTO v_unit;

  INSERT INTO public.audit_log (
    action, table_name, record_id, old_data, new_data,
    performed_by, society_id, notes
  ) VALUES (
    'UPDATE', 'units', v_unit.id::text,
    jsonb_build_object('monthly_amount', v_old_amount),
    jsonb_build_object('monthly_amount', v_unit.monthly_amount),
    v_actor::text, p_society_id, 'Flat maintenance amount updated'
  );
  RETURN v_unit;
END;
$$;

-- Levy definitions are financial setup. The table contains no identity,
-- access, recovery or legal-configuration fields, so finance-scoped writes are
-- appropriate while society_config and units remain Admin-write-only.
DROP POLICY IF EXISTS levy_configs_admin_write ON public.levy_configs;
DROP POLICY IF EXISTS levy_configs_finance_write ON public.levy_configs;
CREATE POLICY levy_configs_finance_write ON public.levy_configs
  FOR ALL TO authenticated
  USING (private.auth_society_finance(society_id))
  WITH CHECK (private.auth_society_finance(society_id));

ALTER TABLE public.advance_settlements
  ADD COLUMN legacy_resolution text,
  ADD COLUMN legacy_reconciled_at timestamptz,
  ADD COLUMN legacy_reconciled_by uuid REFERENCES auth.users(id),
  ADD COLUMN legacy_resolution_note text;

ALTER TABLE public.advance_settlements
  ADD CONSTRAINT advance_settlements_legacy_resolution_check
    CHECK (legacy_resolution IS NULL OR legacy_resolution IN ('LINKED', 'HISTORICAL_UNLINKED')),
  ADD CONSTRAINT advance_settlements_legacy_resolution_shape CHECK (
    legacy_resolution IS NULL
    OR (legacy_resolution = 'LINKED' AND advance_kind = 'PAYMENT' AND bill_id IS NOT NULL
      AND legacy_reconciled_at IS NOT NULL
      AND legacy_reconciled_by IS NOT NULL)
    OR (legacy_resolution = 'HISTORICAL_UNLINKED' AND advance_kind = 'PAYMENT' AND bill_id IS NULL
      AND legacy_reconciled_at IS NOT NULL
      AND legacy_reconciled_by IS NOT NULL
      AND length(trim(legacy_resolution_note)) BETWEEN 10 AND 500)
  );

CREATE OR REPLACE FUNCTION public.reconcile_legacy_advance_settlement(
  p_society_id uuid,
  p_settlement_id uuid,
  p_bill_id uuid DEFAULT NULL,
  p_historical_note text DEFAULT NULL
)
RETURNS public.advance_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_settlement public.advance_settlements;
  v_bill public.bills;
  v_unit_id uuid;
  v_remaining numeric;
BEGIN
  IF p_society_id IS NULL OR v_actor IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF (p_bill_id IS NULL) = (NULLIF(trim(p_historical_note), '') IS NULL)
  THEN RAISE EXCEPTION 'CHOOSE_ONE_RESOLUTION'; END IF;

  SELECT * INTO v_settlement FROM public.advance_settlements
  WHERE id = p_settlement_id AND society_id = p_society_id
    AND advance_kind = 'PAYMENT' AND bill_id IS NULL
    AND legacy_resolution IS NULL AND is_voided = false
  FOR UPDATE;
  IF v_settlement.id IS NULL THEN RAISE EXCEPTION 'SETTLEMENT_NOT_RECONCILABLE'; END IF;

  SELECT unit_id INTO v_unit_id FROM public.payments
  WHERE id = v_settlement.advance_id AND society_id = p_society_id
    AND is_voided = false;
  IF v_unit_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_ADVANCE_NOT_FOUND'; END IF;

  IF p_bill_id IS NOT NULL THEN
    SELECT * INTO v_bill FROM public.bills
    WHERE id = p_bill_id AND society_id = p_society_id AND is_voided = false
    FOR UPDATE;
    IF v_bill.id IS NULL THEN RAISE EXCEPTION 'BILL_NOT_FOUND'; END IF;
    IF v_bill.unit_id IS DISTINCT FROM v_unit_id THEN RAISE EXCEPTION 'BILL_UNIT_MISMATCH'; END IF;
    IF v_bill.status = 'PAID' THEN RAISE EXCEPTION 'BILL_ALREADY_PAID'; END IF;
    IF v_bill.status NOT IN ('ISSUED', 'OVERDUE') THEN RAISE EXCEPTION 'BILL_NOT_PAYABLE'; END IF;
    v_remaining := v_bill.payable_amount - v_bill.amount_settled;
    IF v_settlement.settled_amount > v_remaining + 0.005 THEN
      RAISE EXCEPTION 'SETTLEMENT_EXCEEDS_BILL';
    END IF;

    UPDATE public.bills SET
      amount_settled = amount_settled + v_settlement.settled_amount,
      status = CASE
        WHEN amount_settled + v_settlement.settled_amount >= payable_amount - 0.005 THEN 'PAID'
        ELSE status
      END,
      updated_at = now()
    WHERE id = v_bill.id;

    UPDATE public.advance_settlements SET
      bill_id = v_bill.id,
      legacy_resolution = 'LINKED',
      legacy_reconciled_at = now(),
      legacy_reconciled_by = v_actor,
      legacy_resolution_note = 'Linked to bill by operator'
    WHERE id = v_settlement.id
    RETURNING * INTO v_settlement;
  ELSE
    IF length(trim(p_historical_note)) NOT BETWEEN 10 AND 500
    THEN RAISE EXCEPTION 'INVALID_HISTORICAL_NOTE'; END IF;
    UPDATE public.advance_settlements SET
      legacy_resolution = 'HISTORICAL_UNLINKED',
      legacy_reconciled_at = now(),
      legacy_reconciled_by = v_actor,
      legacy_resolution_note = trim(p_historical_note)
    WHERE id = v_settlement.id
    RETURNING * INTO v_settlement;
  END IF;

  INSERT INTO public.audit_log (
    action, table_name, record_id, old_data, new_data,
    performed_by, society_id, notes
  ) VALUES (
    'UPDATE', 'advance_settlements', v_settlement.id::text,
    jsonb_build_object('bill_id', NULL, 'legacy_resolution', NULL),
    jsonb_build_object(
      'bill_id', v_settlement.bill_id,
      'legacy_resolution', v_settlement.legacy_resolution,
      'legacy_resolution_note', v_settlement.legacy_resolution_note
    ),
    v_actor::text, p_society_id, 'Legacy advance settlement reconciled'
  );

  RETURN v_settlement;
END;
$$;

REVOKE ALL ON FUNCTION public.update_financial_setup(uuid, numeric, integer, numeric, text, text, text, text, text, integer, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_financial_setup(uuid, numeric, integer, numeric, text, text, text, text, text, integer, text) TO authenticated;
REVOKE ALL ON FUNCTION public.set_financial_setup_qr(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_financial_setup_qr(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.update_unit_monthly_amount(uuid, uuid, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_unit_monthly_amount(uuid, uuid, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.reconcile_legacy_advance_settlement(uuid, uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_legacy_advance_settlement(uuid, uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
