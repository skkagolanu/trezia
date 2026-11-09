-- Levy claim paise tolerance.

CREATE OR REPLACE FUNCTION public.approve_resident_levy_claim(
  p_claim_id uuid,
  p_reviewer_id uuid,
  p_method text
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
BEGIN
  SELECT * INTO v_claim FROM public.resident_payment_claims c WHERE c.id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND';
  END IF;

  -- Idempotent no-op, exactly like approve_resident_payment_claim.
  IF v_claim.status = 'approved' THEN
    RETURN v_claim.levy_collection_id;
  END IF;
  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'CLAIM_NOT_PENDING';
  END IF;
  IF cardinality(v_claim.levy_assessment_ids) = 0 THEN
    RAISE EXCEPTION 'NOT_A_LEVY_CLAIM';
  END IF;

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
  -- Paise tolerance rather than exact equality. The claimed figure is derived
  -- in the resident's browser by summing per-assessment balances, so a float
  -- sum of two-decimal values can arrive as 1234.5600000000001 and differ from
  -- this total by a fraction of a paise. The resident cannot correct it — the
  -- amount comes from their selection, not a field they type — so an exact
  -- comparison made the claim permanently unapprovable. Migration 069 gave
  -- assert_payable_bills the same tolerance for the same reason. 0.005 is half
  -- a paise: smaller than any real unit of currency, so it absorbs
  -- representation error and never a genuine discrepancy.
  IF v_claim.amount IS NULL OR abs(v_claim.amount - v_total) > 0.005 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH';
  END IF;

  FOR v_assessment IN
    SELECT a.id, a.levy_label, a.amount, a.amount_settled
    FROM public.levy_assessments a
    WHERE a.id = ANY(v_claim.levy_assessment_ids)
    ORDER BY a.id
  LOOP
    v_apply := v_assessment.amount - v_assessment.amount_settled;

    INSERT INTO public.amc_collections (
      unit_id, society_id, levy_label, amount_paid, payment_date, payment_mode, notes
    ) VALUES (
      v_claim.unit_id, v_claim.society_id, v_assessment.levy_label, v_apply,
      coalesce(v_claim.paid_on, current_date),
      (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'MANUAL_COLLECTION' END),
      'Approved from uploaded payment proof'
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
    SET status = 'approved',
        levy_collection_id = v_first_collection_id,
        reviewed_by = p_reviewer_id,
        reviewed_at = now()
    WHERE id = v_claim.id;

  RETURN v_first_collection_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_resident_levy_claim(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_resident_levy_claim(uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
