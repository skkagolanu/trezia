-- Resident claim payable statuses.

CREATE OR REPLACE FUNCTION public.submit_resident_payment_claim(
  p_unit_id uuid, p_society_id uuid, p_bill_ids uuid[], p_amount numeric,
  p_utr text, p_paid_on date, p_screenshot_key text, p_user_id uuid,
  p_screenshot_sha256 text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
#variable_conflict use_column
DECLARE
  v_claim_id uuid;
  v_claimable_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_unit_id::text, 0));

  SELECT count(*) INTO v_claimable_count
  FROM public.bills
  WHERE id = ANY(p_bill_ids)
    AND unit_id = p_unit_id
    AND society_id = p_society_id
    AND is_voided = false
    AND status IN ('ISSUED', 'OVERDUE');


  IF v_claimable_count IS DISTINCT FROM COALESCE(array_length(p_bill_ids, 1), 0) THEN
    RAISE EXCEPTION 'BILL_NOT_CLAIMABLE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.resident_payment_claims
    WHERE unit_id = p_unit_id AND status = 'pending'
      AND (
        -- Unchanged rule for bill-directed claims: overlapping months conflict.
        (cardinality(p_bill_ids) > 0 AND bill_ids && p_bill_ids)
        -- New rule for advances: `&&` never overlaps on an empty array, so
        -- without this a resident could stack unlimited pending advances.
        -- One pending advance per unit; it does not block a bill claim.
        OR (cardinality(p_bill_ids) = 0 AND cardinality(bill_ids) = 0)
      )
  ) THEN
    RAISE EXCEPTION 'PENDING_CLAIM_EXISTS';
  END IF;

  -- Named errors rather than a raw unique-violation, so the interface can say
  -- "you already submitted this" instead of surfacing a constraint name. Both
  -- checks are advisory; the partial unique indexes remain the real guarantee
  -- under concurrency, and the advisory lock above serialises this unit anyway.
  IF p_screenshot_sha256 IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.resident_payment_claims
    WHERE society_id = p_society_id AND screenshot_sha256 = p_screenshot_sha256
      AND status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_SCREENSHOT';
  END IF;

  IF p_utr IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.resident_payment_claims
    WHERE society_id = p_society_id AND utr_reference = p_utr
      AND status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_UTR';
  END IF;

  INSERT INTO public.resident_payment_claims (
    society_id, unit_id, bill_ids, amount, utr_reference, paid_on,
    screenshot_object_key, status, submitted_by, screenshot_sha256
  ) VALUES (
    p_society_id, p_unit_id, p_bill_ids, p_amount, p_utr, p_paid_on,
    p_screenshot_key, 'pending', p_user_id, p_screenshot_sha256
  )
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_resident_payment_claim(uuid, uuid, uuid[], numeric, text, date, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_resident_payment_claim(uuid, uuid, uuid[], numeric, text, date, text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
