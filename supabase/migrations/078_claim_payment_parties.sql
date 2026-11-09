-- Claim payment parties.

CREATE OR REPLACE FUNCTION private.resolve_claim_payment_parties(
  p_society_id uuid,
  p_unit_id uuid,
  p_submitted_by uuid,
  p_reviewer_id uuid,
  p_record_date date
)
RETURNS TABLE(resident_id uuid, recorded_by text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_fy_start integer;
BEGIN
  SELECT r.id INTO resident_id
  FROM auth.users au
  JOIN public.residents r
    ON lower(r.email) = lower(au.email)
   AND r.society_id = p_society_id
   AND r.unit_id = p_unit_id
  WHERE au.id = p_submitted_by
  ORDER BY r.is_active DESC, r.is_primary DESC, r.created_at, r.id
  LIMIT 1;

  IF resident_id IS NULL THEN
    SELECT r.id INTO resident_id
    FROM public.residents r
    WHERE r.society_id = p_society_id
      AND r.unit_id = p_unit_id
      AND r.is_active = true
    ORDER BY r.is_primary DESC, r.created_at, r.id
    LIMIT 1;
  END IF;

  v_fy_start := CASE
    WHEN extract(month FROM p_record_date)::integer >= 4
      THEN extract(year FROM p_record_date)::integer
    ELSE extract(year FROM p_record_date)::integer - 1
  END;

  SELECT r.full_name INTO recorded_by
  FROM public.fy_treasurers ft
  JOIN public.residents r
    ON r.id = ft.resident_id
   AND r.society_id = ft.society_id
  WHERE ft.society_id = p_society_id
    AND ft.fy_start_year = v_fy_start
  LIMIT 1;

  -- If an FY mapping is absent, use the reviewing operator's on-file name
  -- when that auth account also belongs to a society resident.
  IF recorded_by IS NULL THEN
    SELECT r.full_name INTO recorded_by
    FROM auth.users au
    JOIN public.residents r
      ON lower(r.email) = lower(au.email)
     AND r.society_id = p_society_id
    WHERE au.id = p_reviewer_id
    ORDER BY r.is_active DESC, r.created_at, r.id
    LIMIT 1;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_claim_payment_parties(uuid, uuid, uuid, uuid, date)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_resident_payment_claim(
  p_claim_id uuid, p_reviewer_id uuid, p_method text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_claim public.resident_payment_claims%ROWTYPE;
  v_payment_id uuid;
  v_resident_id uuid;
  v_recorded_by text;
  v_record_date date;
BEGIN
  -- Read only the immutable unit identity before taking any row lock.
  SELECT * INTO v_claim
  FROM public.resident_payment_claims c
  WHERE c.id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_claim.unit_id::text, 0));

  SELECT * INTO v_claim
  FROM public.resident_payment_claims c
  WHERE c.id = p_claim_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF v_claim.status = 'approved' THEN RETURN v_claim.payment_id; END IF;
  IF v_claim.status <> 'pending' THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;
  IF cardinality(v_claim.levy_assessment_ids) > 0 THEN RAISE EXCEPTION 'CLAIM_IS_LEVY_CLAIM'; END IF;

  v_record_date := coalesce(v_claim.paid_on, current_date);
  SELECT parties.resident_id, parties.recorded_by
    INTO v_resident_id, v_recorded_by
  FROM private.resolve_claim_payment_parties(
    v_claim.society_id, v_claim.unit_id, v_claim.submitted_by,
    p_reviewer_id, v_record_date
  ) parties;

  IF cardinality(v_claim.bill_ids) > 0 THEN
    PERFORM public.assert_payable_bills(
      v_claim.society_id, v_claim.unit_id, v_claim.bill_ids, v_claim.amount
    );
    INSERT INTO public.payments (
      unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
      utr_reference, resident_id, recorded_by, months_covered, notes,
      unapplied_amount, auto_apply_credit
    ) VALUES (
      v_claim.unit_id, v_claim.society_id, v_claim.bill_ids, v_claim.amount,
      (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'MANUAL_COLLECTION' END)::public.payment_mode,
      v_record_date, v_claim.utr_reference, v_resident_id, v_recorded_by,
      cardinality(v_claim.bill_ids), 'Approved from uploaded payment proof', 0, false
    ) RETURNING id INTO v_payment_id;

    UPDATE public.bills
    SET status = 'PAID', amount_settled = payable_amount
    WHERE id = ANY(v_claim.bill_ids)
      AND society_id = v_claim.society_id
      AND unit_id = v_claim.unit_id;
  ELSE
    INSERT INTO public.payments (
      unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
      utr_reference, resident_id, recorded_by, months_covered, notes,
      unapplied_amount, auto_apply_credit
    ) VALUES (
      v_claim.unit_id, v_claim.society_id, '{}'::uuid[], v_claim.amount,
      (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'MANUAL_COLLECTION' END)::public.payment_mode,
      v_record_date, v_claim.utr_reference, v_resident_id, v_recorded_by, 0,
      'Approved from uploaded payment proof — account credit applied oldest first',
      v_claim.amount, true
    ) RETURNING id INTO v_payment_id;
  END IF;

  UPDATE public.resident_payment_claims
  SET status = 'approved', payment_id = v_payment_id,
      reviewed_by = p_reviewer_id, reviewed_at = now()
  WHERE id = v_claim.id;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_resident_payment_claim(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_resident_payment_claim(uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.approve_resident_levy_claim(
  p_claim_id uuid, p_reviewer_id uuid, p_method text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_claim public.resident_payment_claims%ROWTYPE;
  v_assessment record;
  v_count integer;
  v_total numeric;
  v_apply numeric;
  v_collection_id uuid;
  v_first_collection_id uuid;
  v_resident_id uuid;
  v_recorded_by text;
  v_record_date date;
BEGIN
  SELECT * INTO v_claim
  FROM public.resident_payment_claims c
  WHERE c.id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_claim.unit_id::text, 0));

  SELECT * INTO v_claim
  FROM public.resident_payment_claims c
  WHERE c.id = p_claim_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF v_claim.status = 'approved' THEN RETURN v_claim.levy_collection_id; END IF;
  IF v_claim.status <> 'pending' THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;
  IF cardinality(v_claim.levy_assessment_ids) = 0 THEN RAISE EXCEPTION 'NOT_A_LEVY_CLAIM'; END IF;

  PERFORM 1 FROM public.levy_assessments a
  WHERE a.id = ANY(v_claim.levy_assessment_ids)
  ORDER BY a.id
  FOR UPDATE;

  SELECT count(*), coalesce(sum(a.amount - a.amount_settled), 0)
    INTO v_count, v_total
  FROM public.levy_assessments a
  WHERE a.id = ANY(v_claim.levy_assessment_ids)
    AND a.society_id = v_claim.society_id
    AND a.unit_id = v_claim.unit_id
    AND a.is_voided = false
    AND a.status <> 'PAID';

  IF v_count <> cardinality(v_claim.levy_assessment_ids) THEN
    RAISE EXCEPTION 'ASSESSMENT_NOT_PAYABLE';
  END IF;
  IF v_claim.amount IS NULL OR abs(v_claim.amount - v_total) > 0.005 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH';
  END IF;

  v_record_date := coalesce(v_claim.paid_on, current_date);
  SELECT parties.resident_id, parties.recorded_by
    INTO v_resident_id, v_recorded_by
  FROM private.resolve_claim_payment_parties(
    v_claim.society_id, v_claim.unit_id, v_claim.submitted_by,
    p_reviewer_id, v_record_date
  ) parties;

  FOR v_assessment IN
    SELECT a.id, a.levy_label, a.amount, a.amount_settled
    FROM public.levy_assessments a
    WHERE a.id = ANY(v_claim.levy_assessment_ids)
    ORDER BY a.id
  LOOP
    v_apply := v_assessment.amount - v_assessment.amount_settled;

    INSERT INTO public.amc_collections (
      unit_id, society_id, resident_id, levy_label, amount_paid, payment_date,
      payment_mode, notes, recorded_by
    ) VALUES (
      v_claim.unit_id, v_claim.society_id, v_resident_id,
      v_assessment.levy_label, v_apply, v_record_date,
      (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'MANUAL_COLLECTION' END),
      'Approved from uploaded payment proof', v_recorded_by
    ) RETURNING id INTO v_collection_id;

    IF v_first_collection_id IS NULL THEN
      v_first_collection_id := v_collection_id;
    END IF;

    UPDATE public.levy_assessments
    SET amount_settled = amount_settled + v_apply,
        status = 'PAID'
    WHERE id = v_assessment.id;
  END LOOP;

  UPDATE public.resident_payment_claims
  SET status = 'approved', levy_collection_id = v_first_collection_id,
      reviewed_by = p_reviewer_id, reviewed_at = now()
  WHERE id = v_claim.id;

  RETURN v_first_collection_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_resident_levy_claim(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_resident_levy_claim(uuid, uuid, text)
  TO service_role;

-- Repair existing accepted proofs without changing amounts, dates, references,
-- receipt numbers, allocations, statuses, or audit history.
DO $$
DECLARE
  v_claim public.resident_payment_claims%ROWTYPE;
  v_resident_id uuid;
  v_recorded_by text;
  v_anchor_created_at timestamptz;
BEGIN
  FOR v_claim IN
    SELECT c.*
    FROM public.resident_payment_claims c
    WHERE c.status = 'approved'
      AND (c.payment_id IS NOT NULL OR c.levy_collection_id IS NOT NULL)
    ORDER BY c.unit_id, c.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_claim.unit_id::text, 0));

    SELECT parties.resident_id, parties.recorded_by
      INTO v_resident_id, v_recorded_by
    FROM private.resolve_claim_payment_parties(
      v_claim.society_id, v_claim.unit_id, v_claim.submitted_by,
      v_claim.reviewed_by, coalesce(v_claim.paid_on, v_claim.reviewed_at::date, current_date)
    ) parties;

    IF v_claim.payment_id IS NOT NULL THEN
      UPDATE public.payments p
      SET resident_id = coalesce(p.resident_id, v_resident_id),
          recorded_by = coalesce(nullif(p.recorded_by, ''), v_recorded_by)
      WHERE p.id = v_claim.payment_id
        AND p.society_id = v_claim.society_id
        AND p.unit_id = v_claim.unit_id
        AND (p.resident_id IS NULL OR nullif(p.recorded_by, '') IS NULL);
    END IF;

    IF v_claim.levy_collection_id IS NOT NULL THEN
      SELECT a.created_at INTO v_anchor_created_at
      FROM public.amc_collections a
      WHERE a.id = v_claim.levy_collection_id
        AND a.society_id = v_claim.society_id
        AND a.unit_id = v_claim.unit_id;

      IF v_anchor_created_at IS NOT NULL THEN
        UPDATE public.amc_collections a
        SET resident_id = coalesce(a.resident_id, v_resident_id),
            recorded_by = coalesce(nullif(a.recorded_by, ''), v_recorded_by)
        WHERE a.society_id = v_claim.society_id
          AND a.unit_id = v_claim.unit_id
          AND a.created_at = v_anchor_created_at
          AND a.levy_label IN (
            SELECT la.levy_label
            FROM public.levy_assessments la
            WHERE la.id = ANY(v_claim.levy_assessment_ids)
          )
          AND (a.resident_id IS NULL OR nullif(a.recorded_by, '') IS NULL);
      END IF;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
