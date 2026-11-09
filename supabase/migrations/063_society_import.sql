-- Society import.
CREATE TABLE public.society_import_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id         uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  stage              text NOT NULL CHECK (stage IN (
                       'flats', 'residents', 'opening_balances', 'levy_configs',
                       'bills', 'payments', 'levy_collections', 'expenses', 'other_income')),
  status             text NOT NULL DEFAULT 'UPLOADED'
                       CHECK (status IN ('UPLOADED', 'VALIDATED', 'COMMITTED', 'FAILED', 'CANCELLED')),
  object_key         text NOT NULL,          -- imports/{societyId}/{batchId}.csv in private R2
  sha256             text NOT NULL,
  row_count          integer NOT NULL DEFAULT 0,
  valid_count        integer NOT NULL DEFAULT 0,
  error_count        integer NOT NULL DEFAULT 0,
  validated_payload_sha256 text,              -- SHA-256 of canonical jsonb rows accepted by validation
  validation_summary jsonb,                  -- dry-run totals + duplicate classification + commit error
  committed_ids      jsonb,                  -- { committed, skipped, target_ids }
  created_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  validated_at       timestamptz,
  committed_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX society_import_batches_society_created_idx
  ON public.society_import_batches (society_id, created_at DESC);

-- 2. Per-row provenance — only the actionable (error/duplicate) rows are kept;
--    valid rows are re-derived from the stored CSV at commit time.
CREATE TABLE public.society_import_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL REFERENCES public.society_import_batches(id) ON DELETE CASCADE,
  row_number  integer NOT NULL,
  raw         jsonb NOT NULL,
  status      text NOT NULL CHECK (status IN ('ERROR', 'DUPLICATE_SKIP')),
  errors      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX society_import_records_batch_idx
  ON public.society_import_records (batch_id, row_number);

ALTER TABLE public.society_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.society_import_records ENABLE ROW LEVEL SECURITY;

-- Admin-only reads; no client write policy (service role bypasses RLS).
CREATE POLICY society_import_batches_admin_read ON public.society_import_batches
  FOR SELECT TO authenticated
  USING (private.auth_society_admin(society_id));

CREATE POLICY society_import_records_admin_read ON public.society_import_records
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.society_import_batches b
    WHERE b.id = batch_id AND private.auth_society_admin(b.society_id)));

-- 3. Lifecycle RPCs ---------------------------------------------------------

-- The caller supplies the batch id so the R2 object key
-- (imports/{society}/{batchId}.csv) is known before the row exists.
CREATE OR REPLACE FUNCTION public.create_import_batch(
  p_batch_id uuid, p_society_id uuid, p_stage text, p_object_key text, p_sha256 text,
  p_row_count integer, p_created_by uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.society_import_batches (id, society_id, stage, object_key, sha256, row_count, created_by)
  VALUES (p_batch_id, p_society_id, p_stage, p_object_key, p_sha256, p_row_count, p_created_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_import_validation(
  p_batch_id uuid, p_society_id uuid, p_valid_count integer, p_error_count integer,
  p_summary jsonb, p_records jsonb, p_rows jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_batch public.society_import_batches%ROWTYPE;
BEGIN
  SELECT * INTO v_batch FROM public.society_import_batches
    WHERE id = p_batch_id AND society_id = p_society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  IF v_batch.status NOT IN ('UPLOADED', 'VALIDATED') THEN RAISE EXCEPTION 'BATCH_NOT_VALIDATABLE'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'VALIDATION_ROWS_NOT_ARRAY'; END IF;
  IF p_valid_count < 0 OR p_error_count < 0 OR jsonb_array_length(p_rows) <> p_valid_count THEN
    RAISE EXCEPTION 'VALIDATION_COUNT_MISMATCH';
  END IF;
  IF jsonb_typeof(p_summary->'header_errors') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'VALIDATION_HEADER_ERRORS_NOT_ARRAY';
  END IF;
  IF COALESCE((p_summary->>'total_rows')::integer, -1) <> v_batch.row_count
     OR COALESCE((p_summary->>'valid')::integer, -1) <> p_valid_count
     OR COALESCE((p_summary->>'errors')::integer, -1) <> p_error_count
     OR COALESCE((p_summary->>'duplicates')::integer, -1) < 0
     OR p_valid_count + p_error_count + COALESCE((p_summary->>'duplicates')::integer, -1) <> v_batch.row_count THEN
    RAISE EXCEPTION 'VALIDATION_SUMMARY_MISMATCH';
  END IF;

  DELETE FROM public.society_import_records WHERE batch_id = p_batch_id;
  IF p_records IS NOT NULL AND jsonb_typeof(p_records) = 'array' THEN
    INSERT INTO public.society_import_records (batch_id, row_number, raw, status, errors)
    SELECT p_batch_id, (elem->>'row_number')::int, elem->'raw', elem->>'status', elem->'errors'
    FROM jsonb_array_elements(p_records) AS elem;
  END IF;

  UPDATE public.society_import_batches
    SET status = 'VALIDATED', valid_count = p_valid_count, error_count = p_error_count,
        validation_summary = p_summary,
        validated_payload_sha256 = encode(digest(convert_to(p_rows::text, 'UTF8'), 'sha256'), 'hex'),
        validated_at = now(), updated_at = now()
    WHERE id = p_batch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_import_batch(
  p_batch_id uuid, p_society_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.society_import_batches
    WHERE id = p_batch_id AND society_id = p_society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  IF v_status = 'COMMITTED' THEN RAISE EXCEPTION 'BATCH_ALREADY_COMMITTED'; END IF;
  UPDATE public.society_import_batches
    SET status = 'CANCELLED', updated_at = now() WHERE id = p_batch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_import_batch(
  p_batch_id uuid, p_society_id uuid, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  UPDATE public.society_import_batches
    SET status = 'FAILED', updated_at = now(),
        validation_summary = COALESCE(validation_summary, '{}'::jsonb) || jsonb_build_object('commit_error', p_reason)
    WHERE id = p_batch_id AND society_id = p_society_id AND status <> 'COMMITTED';
END;
$$;

-- 4. Commit dispatcher ------------------------------------------------------
-- Reads the stage from the batch, applies every row of p_rows (the cell-valid
-- rows) transactionally, and returns { committed, skipped, target_ids }. Any
-- unresolved reference, existing financial identifier, or broken invariant
-- RAISEs, rolling the entire stage back. Idempotent: a re-commit of an already
-- COMMITTED batch returns its stored result without writing again.
-- search_path is the explicit `public, extensions` the payment/bill triggers
-- (receipt numbering, row hashing via digest(), audit) need to resolve.
CREATE OR REPLACE FUNCTION public.commit_import_stage(
  p_batch_id uuid, p_society_id uuid, p_actor uuid, p_rows jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_batch     public.society_import_batches%ROWTYPE;
  v_elem      jsonb;
  v_unit      uuid;
  v_id        uuid;
  v_committed integer := 0;
  v_skipped   integer := 0;
  v_ids       jsonb := '[]'::jsonb;
  v_hist      integer;
  v_receipt   text;
  v_invoice   text;
  v_flat      text;
  v_name      text;
  v_primary   boolean;
  v_bill_ids  uuid[];
  v_inv_list  text[];
  v_result    jsonb;
BEGIN
  SELECT * INTO v_batch FROM public.society_import_batches
    WHERE id = p_batch_id AND society_id = p_society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  IF v_batch.status = 'COMMITTED' THEN RETURN v_batch.committed_ids; END IF;
  IF v_batch.status <> 'VALIDATED' THEN RAISE EXCEPTION 'BATCH_NOT_COMMITTABLE'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'COMMIT_ROWS_NOT_ARRAY'; END IF;
  IF v_batch.error_count <> 0 OR v_batch.valid_count <= 0 THEN RAISE EXCEPTION 'BATCH_HAS_VALIDATION_ERRORS'; END IF;
  IF jsonb_array_length(p_rows) <> v_batch.valid_count THEN RAISE EXCEPTION 'COMMIT_COUNT_MISMATCH'; END IF;
  IF COALESCE(jsonb_array_length(v_batch.validation_summary->'header_errors'), 0) <> 0 THEN
    RAISE EXCEPTION 'BATCH_HAS_HEADER_ERRORS';
  END IF;
  IF v_batch.validated_payload_sha256 IS NULL
     OR encode(digest(convert_to(p_rows::text, 'UTF8'), 'sha256'), 'hex') <> v_batch.validated_payload_sha256 THEN
    RAISE EXCEPTION 'COMMIT_PAYLOAD_MISMATCH';
  END IF;

  IF v_batch.stage = 'flats' THEN
    FOR v_elem IN SELECT jsonb_array_elements(p_rows) LOOP
      v_flat := v_elem->>'flat_number';
      IF EXISTS (SELECT 1 FROM public.units WHERE society_id = p_society_id AND flat_number = v_flat) THEN
        v_skipped := v_skipped + 1; CONTINUE;
      END IF;
      INSERT INTO public.units (society_id, flat_number, flat_area_sqft, monthly_amount, notes, is_active, is_test_unit)
      VALUES (p_society_id, v_flat, (v_elem->>'flat_area_sqft')::numeric, (v_elem->>'monthly_amount')::numeric,
              NULLIF(v_elem->>'notes', ''), true, false)
      RETURNING id INTO v_id;
      v_committed := v_committed + 1; v_ids := v_ids || to_jsonb(v_id);
    END LOOP;

  ELSIF v_batch.stage = 'residents' THEN
    FOR v_elem IN SELECT jsonb_array_elements(p_rows) LOOP
      v_flat := v_elem->>'flat_number';
      SELECT id INTO v_unit FROM public.units WHERE society_id = p_society_id AND flat_number = v_flat;
      IF NOT FOUND THEN RAISE EXCEPTION 'UNRESOLVED_FLAT:%', v_flat; END IF;
      v_name := v_elem->>'full_name';
      IF EXISTS (SELECT 1 FROM public.residents WHERE unit_id = v_unit AND lower(full_name) = lower(v_name)) THEN
        v_skipped := v_skipped + 1; CONTINUE;
      END IF;
      -- At most one active primary per flat: the dues view joins on is_primary,
      -- so a second primary would double-count. First eligible resident becomes
      -- primary; the CSV can only downgrade, never create a second one.
      v_primary := NOT EXISTS (SELECT 1 FROM public.residents WHERE unit_id = v_unit AND is_primary AND is_active);
      IF (v_elem ? 'is_primary') AND (v_elem->>'is_primary') = 'false' THEN v_primary := false; END IF;
      INSERT INTO public.residents (unit_id, full_name, occupancy_type, phone, email,
              notification_channel, consent_given, is_primary, is_active, notes)
      VALUES (v_unit, v_name, COALESCE(NULLIF(v_elem->>'occupancy_type', ''), 'OWNER')::occupancy_type,
              NULLIF(v_elem->>'phone', ''), NULLIF(v_elem->>'email', ''), 'NONE', false, v_primary,
              COALESCE((v_elem->>'is_active')::boolean, true), NULLIF(v_elem->>'notes', ''))
      RETURNING id INTO v_id;
      v_committed := v_committed + 1; v_ids := v_ids || to_jsonb(v_id);
    END LOOP;

  ELSIF v_batch.stage = 'opening_balances' THEN
    FOR v_elem IN SELECT jsonb_array_elements(p_rows) LOOP
      IF EXISTS (SELECT 1 FROM public.opening_balances
                 WHERE society_id = p_society_id AND fy_start_year = (v_elem->>'fy_start_year')::int) THEN
        RAISE EXCEPTION 'OPENING_BALANCE_EXISTS:%', v_elem->>'fy_start_year';
      END IF;
      INSERT INTO public.opening_balances (society_id, fy_start_year, bank_balance, cash_in_hand, notes, recorded_by)
      VALUES (p_society_id, (v_elem->>'fy_start_year')::int, (v_elem->>'bank_balance')::numeric,
              (v_elem->>'cash_in_hand')::numeric, NULLIF(v_elem->>'notes', ''), p_actor)
      RETURNING id INTO v_id;
      v_committed := v_committed + 1; v_ids := v_ids || to_jsonb(v_id);
    END LOOP;

  ELSIF v_batch.stage = 'levy_configs' THEN
    FOR v_elem IN SELECT jsonb_array_elements(p_rows) LOOP
      IF EXISTS (SELECT 1 FROM public.levy_configs
                 WHERE society_id = p_society_id AND levy_label = v_elem->>'levy_label') THEN
        v_skipped := v_skipped + 1; CONTINUE;
      END IF;
      INSERT INTO public.levy_configs (society_id, levy_label, default_amount)
      VALUES (p_society_id, v_elem->>'levy_label', (v_elem->>'default_amount')::numeric)
      RETURNING id INTO v_id;
      v_committed := v_committed + 1; v_ids := v_ids || to_jsonb(v_id);
    END LOOP;

  ELSIF v_batch.stage = 'bills' THEN
    SELECT COALESCE(MAX((substring(invoice_number FROM '^HIST-(\d+)$'))::int), 0) INTO v_hist
      FROM public.bills WHERE society_id = p_society_id AND invoice_number ~ '^HIST-\d+$';
    FOR v_elem IN SELECT jsonb_array_elements(p_rows) LOOP
      v_flat := v_elem->>'flat_number';
      SELECT id INTO v_unit FROM public.units WHERE society_id = p_society_id AND flat_number = v_flat;
      IF NOT FOUND THEN RAISE EXCEPTION 'UNRESOLVED_FLAT:%', v_flat; END IF;
      v_invoice := NULLIF(v_elem->>'invoice_number', '');
      IF v_invoice IS NULL THEN
        v_hist := v_hist + 1; v_invoice := 'HIST-' || LPAD(v_hist::text, 4, '0');
      ELSIF EXISTS (SELECT 1 FROM public.bills WHERE society_id = p_society_id AND invoice_number = v_invoice) THEN
        RAISE EXCEPTION 'INVOICE_EXISTS:%', v_invoice;
      END IF;
      INSERT INTO public.bills (society_id, unit_id, bill_period_year, bill_period_month, invoice_number,
              invoice_date, due_date, base_amount, previous_due, penalty_amount, status)
      VALUES (p_society_id, v_unit, (v_elem->>'bill_period_year')::int, (v_elem->>'bill_period_month')::int,
              v_invoice, (v_elem->>'invoice_date')::date, (v_elem->>'due_date')::date,
              (v_elem->>'base_amount')::numeric, COALESCE((v_elem->>'previous_due')::numeric, 0),
              COALESCE((v_elem->>'penalty_amount')::numeric, 0),
              COALESCE(NULLIF(v_elem->>'status', ''), 'ISSUED')::bill_status)
      RETURNING id INTO v_id;
      v_committed := v_committed + 1; v_ids := v_ids || to_jsonb(v_id);
    END LOOP;

  ELSIF v_batch.stage = 'payments' THEN
    SELECT COALESCE(MAX((substring(receipt_number FROM '^HIST-(\d+)$'))::int), 0) INTO v_hist
      FROM public.payments WHERE society_id = p_society_id AND receipt_number ~ '^HIST-\d+$';
    FOR v_elem IN SELECT jsonb_array_elements(p_rows) LOOP
      v_flat := v_elem->>'flat_number';
      SELECT id INTO v_unit FROM public.units WHERE society_id = p_society_id AND flat_number = v_flat;
      IF NOT FOUND THEN RAISE EXCEPTION 'UNRESOLVED_FLAT:%', v_flat; END IF;
      v_receipt := NULLIF(v_elem->>'receipt_number', '');
      IF v_receipt IS NULL THEN
        v_hist := v_hist + 1; v_receipt := 'HIST-' || LPAD(v_hist::text, 4, '0');
      ELSIF EXISTS (SELECT 1 FROM public.payments WHERE society_id = p_society_id AND receipt_number = v_receipt) THEN
        RAISE EXCEPTION 'RECEIPT_EXISTS:%', v_receipt;
      END IF;

      IF NULLIF(v_elem->>'bill_invoice_numbers', '') IS NOT NULL THEN
        -- Allocated: resolve invoice numbers to bills, then reuse migration 061's
        -- exact payable-total invariant (all bills payable, sum equals amount).
        SELECT ARRAY(SELECT trim(x) FROM unnest(string_to_array(v_elem->>'bill_invoice_numbers', ',')) AS x
                     WHERE trim(x) <> '') INTO v_inv_list;
        SELECT ARRAY(SELECT b.id FROM public.bills b
                     WHERE b.society_id = p_society_id AND b.unit_id = v_unit AND b.invoice_number = ANY(v_inv_list))
          INTO v_bill_ids;
        IF cardinality(v_bill_ids) <> cardinality(v_inv_list) THEN
          RAISE EXCEPTION 'UNRESOLVED_ALLOCATION_BILLS:%', v_elem->>'bill_invoice_numbers';
        END IF;
        PERFORM public.assert_payable_bills(p_society_id, v_unit, v_bill_ids, (v_elem->>'amount_paid')::numeric);
        INSERT INTO public.payments (unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
                receipt_number, utr_reference, months_detail, months_covered, notes)
        VALUES (v_unit, p_society_id, v_bill_ids, (v_elem->>'amount_paid')::numeric,
                (v_elem->>'payment_mode')::payment_mode, (v_elem->>'payment_date')::date, v_receipt,
                NULLIF(v_elem->>'utr_reference', ''), NULLIF(v_elem->>'months_detail', ''), 0,
                NULLIF(v_elem->>'notes', ''))
        RETURNING id INTO v_id;
        UPDATE public.bills SET status = 'PAID'
          WHERE id = ANY(v_bill_ids) AND society_id = p_society_id AND unit_id = v_unit AND status <> 'PAID';
      ELSE
        -- Legacy-unallocated: records money without changing any bill state, and
        -- only when the operator explicitly acknowledged it.
        IF COALESCE((v_elem->>'unallocated')::boolean, false) IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'UNALLOCATED_NOT_ACKNOWLEDGED';
        END IF;
        INSERT INTO public.payments (unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
                receipt_number, utr_reference, months_detail, months_covered, notes)
        VALUES (v_unit, p_society_id, '{}'::uuid[], (v_elem->>'amount_paid')::numeric,
                (v_elem->>'payment_mode')::payment_mode, (v_elem->>'payment_date')::date, v_receipt,
                NULLIF(v_elem->>'utr_reference', ''), NULLIF(v_elem->>'months_detail', ''), 0,
                NULLIF(v_elem->>'notes', ''))
        RETURNING id INTO v_id;
      END IF;
      v_committed := v_committed + 1; v_ids := v_ids || to_jsonb(v_id);
    END LOOP;

  ELSIF v_batch.stage = 'levy_collections' THEN
    FOR v_elem IN SELECT jsonb_array_elements(p_rows) LOOP
      v_flat := v_elem->>'flat_number';
      SELECT id INTO v_unit FROM public.units WHERE society_id = p_society_id AND flat_number = v_flat;
      IF NOT FOUND THEN RAISE EXCEPTION 'UNRESOLVED_FLAT:%', v_flat; END IF;
      INSERT INTO public.amc_collections (society_id, unit_id, levy_label, amount_paid, payment_date, payment_mode, notes)
      VALUES (p_society_id, v_unit, v_elem->>'levy_label', (v_elem->>'amount_paid')::numeric,
              (NULLIF(v_elem->>'payment_date', ''))::date,
              COALESCE(NULLIF(v_elem->>'payment_mode', ''), 'MANUAL_COLLECTION'), NULLIF(v_elem->>'notes', ''))
      RETURNING id INTO v_id;
      v_committed := v_committed + 1; v_ids := v_ids || to_jsonb(v_id);
    END LOOP;

  ELSIF v_batch.stage = 'expenses' THEN
    FOR v_elem IN SELECT jsonb_array_elements(p_rows) LOOP
      INSERT INTO public.expenditures (society_id, expense_date, category, description, amount,
              paid_via, payee_name, reference_number, notes)
      VALUES (p_society_id, (v_elem->>'expense_date')::date, (v_elem->>'category')::expense_category,
              v_elem->>'description', (v_elem->>'amount')::numeric, NULLIF(v_elem->>'paid_via', ''),
              NULLIF(v_elem->>'payee_name', ''), NULLIF(v_elem->>'reference_number', ''), NULLIF(v_elem->>'notes', ''))
      RETURNING id INTO v_id;
      v_committed := v_committed + 1; v_ids := v_ids || to_jsonb(v_id);
    END LOOP;

  ELSIF v_batch.stage = 'other_income' THEN
    FOR v_elem IN SELECT jsonb_array_elements(p_rows) LOOP
      INSERT INTO public.other_income (society_id, income_date, category, description, amount,
              received_via, reference_number, notes)
      VALUES (p_society_id, (v_elem->>'income_date')::date, (v_elem->>'category')::income_category,
              v_elem->>'description', (v_elem->>'amount')::numeric, NULLIF(v_elem->>'received_via', ''),
              NULLIF(v_elem->>'reference_number', ''), NULLIF(v_elem->>'notes', ''))
      RETURNING id INTO v_id;
      v_committed := v_committed + 1; v_ids := v_ids || to_jsonb(v_id);
    END LOOP;

  ELSE
    RAISE EXCEPTION 'UNKNOWN_STAGE:%', v_batch.stage;
  END IF;

  v_result := jsonb_build_object('committed', v_committed, 'skipped', v_skipped, 'target_ids', v_ids);
  UPDATE public.society_import_batches
    SET status = 'COMMITTED', committed_ids = v_result, committed_at = now(), updated_at = now()
    WHERE id = p_batch_id;
  RETURN v_result;
END;
$$;

-- 5. Grants — every function is service-role only.
REVOKE ALL ON FUNCTION public.create_import_batch(uuid, uuid, text, text, text, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_import_validation(uuid, uuid, integer, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_import_batch(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_import_batch(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_import_stage(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_import_batch(uuid, uuid, text, text, text, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_import_validation(uuid, uuid, integer, integer, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_import_batch(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_import_batch(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_import_stage(uuid, uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
