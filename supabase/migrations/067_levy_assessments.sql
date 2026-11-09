-- Levy assessments.

CREATE TABLE public.levy_assessments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id      uuid NOT NULL REFERENCES public.societies(id),
  unit_id         uuid NOT NULL REFERENCES public.units(id),
  levy_label      text NOT NULL,
  amount          numeric NOT NULL CHECK (amount > 0),
  amount_settled  numeric NOT NULL DEFAULT 0 CHECK (amount_settled >= 0),
  -- Mirrors bills' vocabulary (bill_status: DRAFT/ISSUED/PAID/OVERDUE/CANCELLED)
  -- only where it actually applies. A levy is raised already-due (no DRAFT/
  -- ISSUED distinction — see raise_levy_assessment below) and is never
  -- individually overdue-flagged or cancelled outside voiding, so the
  -- vocabulary is narrowed to the two states that mean something here.
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID')),
  is_voided       boolean NOT NULL DEFAULT false,
  void_reason     text,
  voided_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Tenant integrity: an assessment's unit must belong to the same society as
-- the assessment. Same pattern as resident_payment_claims (migration 059).
ALTER TABLE public.levy_assessments ADD CONSTRAINT levy_assessments_unit_same_society
  FOREIGN KEY (unit_id, society_id) REFERENCES public.units(id, society_id);

-- One live assessment per unit per levy label. Partial (WHERE NOT is_voided)
-- so a voided assessment never blocks a corrected re-raise, and this is the
-- idempotency guarantee raise_levy_assessment relies on to be safely re-run.
CREATE UNIQUE INDEX levy_assessments_unit_levy_unique
  ON public.levy_assessments (society_id, unit_id, levy_label) WHERE NOT is_voided;

CREATE INDEX levy_assessments_society_status_idx ON public.levy_assessments (society_id, status);
CREATE INDEX levy_assessments_unit_idx ON public.levy_assessments (unit_id);

ALTER TABLE public.levy_assessments ENABLE ROW LEVEL SECURITY;

-- Operators (Admin/Treasurer) read every assessment in their society; a
-- suspended-society Platform Owner retains read access, matching every other
-- financial table's operator policy (migration 055/059 pattern).
CREATE POLICY levy_assessments_operator_select ON public.levy_assessments
  FOR SELECT TO authenticated
  USING (private.auth_society_finance(society_id) OR private.auth_platform_suspended_read(society_id));

-- A resident sees only their own unit's assessments — mirrors
-- resident_payment_claims_resident_select exactly.
CREATE POLICY levy_assessments_resident_select ON public.levy_assessments
  FOR SELECT TO authenticated
  USING (unit_id = private.auth_membership_unit(society_id));

-- No INSERT/UPDATE/DELETE policy for any client role, including operators:
-- every write (raise, collect, claim-approve) goes through a transactional
-- RPC below so the advisory lock and amount_settled bookkeeping cannot be
-- bypassed by a direct table write.

CREATE TRIGGER trg_levy_assessments_ts BEFORE UPDATE ON public.levy_assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_levy_assessments_audit AFTER INSERT OR UPDATE ON public.levy_assessments
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER trg_levy_assessments_no_delete BEFORE DELETE ON public.levy_assessments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_operational_hard_delete();

-- ---------------------------------------------------------------------------
-- 2. Backfill — without rewriting history
-- ---------------------------------------------------------------------------
--
-- One assessment per existing levy_configs row per active, non-test unit in
-- that society, using the config's default_amount. amount_settled is seeded
-- from that unit's existing non-voided amc_collections for the same
-- levy_label (capped at the assessed amount, since a historical overpayment
-- must not violate the amount_settled <= amount expectation the UI reads
-- against); the assessment is marked PAID where that fully covers it.
-- levy_label values are historical financial identifiers and are copied
-- verbatim, never rewritten. A config with default_amount = 0 is skipped
-- outright — there is no obligation to assess.
INSERT INTO public.levy_assessments (society_id, unit_id, levy_label, amount, amount_settled, status)
SELECT
  lc.society_id,
  u.id,
  lc.levy_label,
  lc.default_amount,
  LEAST(lc.default_amount, COALESCE(collected.total, 0)),
  CASE WHEN COALESCE(collected.total, 0) >= lc.default_amount THEN 'PAID' ELSE 'PENDING' END
FROM public.levy_configs lc
JOIN public.units u
  ON u.society_id = lc.society_id
 AND u.is_active = true
 AND u.is_test_unit = false
LEFT JOIN LATERAL (
  SELECT SUM(ac.amount_paid) AS total
  FROM public.amc_collections ac
  WHERE ac.unit_id = u.id
    AND ac.society_id = lc.society_id
    AND ac.levy_label = lc.levy_label
    AND ac.is_voided = false
) collected ON true
WHERE lc.default_amount > 0
ON CONFLICT (society_id, unit_id, levy_label) WHERE NOT is_voided DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Raising a levy — service-role RPC backing POST /api/levy-assessments
-- ---------------------------------------------------------------------------
--
-- Idempotent by construction: ON CONFLICT DO NOTHING against the same partial
-- unique index the backfill relies on, so re-running the same levy_label at
-- the same (or a different) amount for a society that already has it never
-- duplicates a row — it reports the unit as skipped instead.
CREATE OR REPLACE FUNCTION public.raise_levy_assessment(
  p_society_id uuid,
  p_levy_label text,
  p_amount numeric
)
RETURNS TABLE(created_count integer, skipped_count integer, total_units integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_created integer;
  v_total integer;
BEGIN
  IF p_society_id IS NULL
    OR p_levy_label IS NULL OR char_length(trim(p_levy_label)) = 0
    OR p_amount IS NULL OR p_amount <= 0
  THEN
    RAISE EXCEPTION 'INVALID_LEVY_ASSESSMENT';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.units
  WHERE society_id = p_society_id AND is_active = true AND is_test_unit = false;

  WITH inserted AS (
    INSERT INTO public.levy_assessments (society_id, unit_id, levy_label, amount)
    SELECT p_society_id, u.id, p_levy_label, p_amount
    FROM public.units u
    WHERE u.society_id = p_society_id AND u.is_active = true AND u.is_test_unit = false
    ON CONFLICT (society_id, unit_id, levy_label) WHERE NOT is_voided DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_created FROM inserted;

  RETURN QUERY SELECT v_created, v_total - v_created, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.raise_levy_assessment(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_levy_assessment(uuid, text, numeric) TO service_role;


CREATE OR REPLACE FUNCTION public.record_levy_collection(
  p_society_id uuid,
  p_unit_id uuid,
  p_resident_id uuid,
  p_levy_label text,
  p_amount_paid numeric,
  p_payment_date date,
  p_payment_mode text,
  p_notes text,
  p_recorded_by text
)
RETURNS public.amc_collections
LANGUAGE plpgsql
SECURITY DEFINER
-- Not search_path = '': inserting into amc_collections fires the audit
-- trigger (log_audit_event), which uses unqualified names and belongs to the
-- calling function's search_path, not its own. Same fixed, non-attacker-
-- controllable path every other financial RPC in this codebase uses.
SET search_path = public, extensions
AS $$
DECLARE
  v_collection public.amc_collections;
  v_assessment_id uuid;
  v_assessment_amount numeric;
  v_assessment_settled numeric;
BEGIN
  IF p_society_id IS NULL
    OR (SELECT auth.uid()) IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_unit_id IS NULL
    OR p_levy_label IS NULL OR char_length(trim(p_levy_label)) = 0
    OR p_amount_paid IS NULL OR p_amount_paid <= 0
  THEN
    RAISE EXCEPTION 'INVALID_LEVY_COLLECTION';
  END IF;

  -- Same lock key as submit_resident_payment_claim / submit_resident_levy_claim
  -- for this unit, so a direct entry here and a resident claim submission or
  -- approval touching the same flat's assessments serialise against each other.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_unit_id::text, 0));

  INSERT INTO public.amc_collections (
    unit_id, society_id, resident_id, levy_label, amount_paid, payment_date,
    payment_mode, notes, recorded_by
  ) VALUES (
    p_unit_id, p_society_id, p_resident_id, p_levy_label, p_amount_paid, p_payment_date,
    COALESCE(p_payment_mode, 'MANUAL_COLLECTION'), p_notes, p_recorded_by
  ) RETURNING * INTO v_collection;

  -- If an assessment exists for this unit+levy, apply the payment to it too.
  -- This is the entire point of the obligation row: without this update the
  -- assessment would silently drift out of sync with the very collection that
  -- pays it. No assessment existing (e.g. a levy_label never raised through
  -- raise_levy_assessment) is not an error — the collection still records the
  -- money, matching pre-migration behaviour exactly for that case.
  SELECT a.id, a.amount, a.amount_settled
    INTO v_assessment_id, v_assessment_amount, v_assessment_settled
  FROM public.levy_assessments a
  WHERE a.society_id = p_society_id AND a.unit_id = p_unit_id AND a.levy_label = p_levy_label
    AND a.is_voided = false
  FOR UPDATE;

  IF FOUND THEN
    -- Refuse to credit an obligation that is already met. Without this the
    -- update below is a blind increment: a resident's approved claim settles the
    -- assessment, the treasurer then records the same payment by hand, and the
    -- flat is credited twice with amount_settled quietly exceeding amount. That
    -- double-credit is the exact failure the assessment row exists to prevent,
    -- so the check belongs here rather than in the interface.
    --
    -- Mirrors create_advance_settlement's vocabulary (BILL_ALREADY_PAID /
    -- SETTLEMENT_EXCEEDS_BILL) so the two settlement paths read the same way.
    IF v_assessment_settled >= v_assessment_amount - 0.005 THEN
      RAISE EXCEPTION 'LEVY_ALREADY_SETTLED';
    END IF;
    IF v_assessment_settled + p_amount_paid > v_assessment_amount + 0.005 THEN
      RAISE EXCEPTION 'COLLECTION_EXCEEDS_ASSESSMENT';
    END IF;

    UPDATE public.levy_assessments
      SET amount_settled = amount_settled + p_amount_paid,
          status = CASE WHEN v_assessment_settled + p_amount_paid >= v_assessment_amount - 0.005
                        THEN 'PAID' ELSE status END
      WHERE id = v_assessment_id;
  END IF;

  RETURN v_collection;
END;
$$;

REVOKE ALL ON FUNCTION public.record_levy_collection(uuid, uuid, uuid, text, numeric, date, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_levy_collection(uuid, uuid, uuid, text, numeric, date, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Resident levy claims — new sibling RPCs, bill claim path untouched
-- ---------------------------------------------------------------------------
--
-- submit_resident_payment_claim and approve_resident_payment_claim (migration
-- 066) are NOT modified by this migration: the bill claim path stays exactly
-- as it is. These are new, separate functions for levy assessments, mirroring
-- that structure.

ALTER TABLE public.resident_payment_claims
  ADD COLUMN IF NOT EXISTS levy_assessment_ids uuid[] NOT NULL DEFAULT '{}';

-- Parallel to payment_id (the bill path's result pointer): the levy path's
-- result is an amc_collections row, not a payments row, so it needs its own
-- pointer for approve_resident_levy_claim's idempotent re-approval to return.
ALTER TABLE public.resident_payment_claims
  ADD COLUMN IF NOT EXISTS levy_collection_id uuid REFERENCES public.amc_collections(id);

-- A claim carries bills OR levy assessments, never both — the two approval
-- paths are structurally different (bill exact-total-or-oldest-first
-- appropriation vs. one-shot exact settlement of the named assessments) and
-- mixing them would ask one RPC to do both.
ALTER TABLE public.resident_payment_claims
  ADD CONSTRAINT resident_payment_claims_bill_xor_levy
  CHECK (cardinality(bill_ids) = 0 OR cardinality(levy_assessment_ids) = 0);

CREATE OR REPLACE FUNCTION public.submit_resident_levy_claim(
  p_unit_id uuid,
  p_society_id uuid,
  p_levy_assessment_ids uuid[],
  p_amount numeric,
  p_utr text,
  p_paid_on date,
  p_screenshot_key text,
  p_user_id uuid,
  p_screenshot_sha256 text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_claim_id uuid;
  v_claimable_count integer;
BEGIN
  -- SAME lock key as submit_resident_payment_claim for this unit, so a bill
  -- claim and a levy claim submitted for the same flat serialise against
  -- each other rather than racing on independent dedup checks.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_unit_id::text, 0));

  IF p_levy_assessment_ids IS NULL OR cardinality(p_levy_assessment_ids) = 0
     OR cardinality(p_levy_assessment_ids) <>
        cardinality(ARRAY(SELECT DISTINCT x FROM unnest(p_levy_assessment_ids) AS x))
  THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_ASSESSMENT_IDS';
  END IF;

  SELECT count(*) INTO v_claimable_count
  FROM public.levy_assessments a
  WHERE a.id = ANY(p_levy_assessment_ids)
    AND a.unit_id = p_unit_id
    AND a.society_id = p_society_id
    AND a.is_voided = false
    AND a.status <> 'PAID';

  IF v_claimable_count IS DISTINCT FROM cardinality(p_levy_assessment_ids) THEN
    RAISE EXCEPTION 'ASSESSMENT_NOT_CLAIMABLE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.resident_payment_claims
    WHERE unit_id = p_unit_id AND status = 'pending'
      AND levy_assessment_ids && p_levy_assessment_ids
  ) THEN
    RAISE EXCEPTION 'PENDING_CLAIM_EXISTS';
  END IF;

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
    society_id, unit_id, bill_ids, levy_assessment_ids, amount, utr_reference, paid_on,
    screenshot_object_key, status, submitted_by, screenshot_sha256
  ) VALUES (
    p_society_id, p_unit_id, '{}', p_levy_assessment_ids, p_amount, p_utr, p_paid_on,
    p_screenshot_key, 'pending', p_user_id, p_screenshot_sha256
  )
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$;

-- Exact-total settlement of every named assessment in one shot: a levy claim
-- names specific assessments (unlike the bill path's undirected/oldest-first
-- branch), so the claimed amount must exactly equal their combined
-- outstanding balance. Because it is exact, approving always fully settles
-- every named assessment to PAID — there is no partial-levy-claim case to
-- handle. One amc_collections row per assessment (not one row for the whole
-- claim) so each keeps its own historical levy_label rather than collapsing
-- several into one, exactly mirroring how POST /api/levies has always
-- recorded one label at a time.
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
  IF v_claim.amount IS DISTINCT FROM v_total THEN
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

REVOKE ALL ON FUNCTION public.submit_resident_levy_claim(uuid, uuid, uuid[], numeric, text, date, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_resident_levy_claim(uuid, uuid, uuid[], numeric, text, date, text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.approve_resident_levy_claim(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_resident_levy_claim(uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- Guard the bill approval path against a levy claim (see comment inside).
-- Re-declared here rather than edited in 066, which is already applied.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_resident_payment_claim(
  p_claim_id uuid, p_reviewer_id uuid, p_method text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
#variable_conflict use_column
DECLARE
  v_claim public.resident_payment_claims%ROWTYPE;
  v_payment_id uuid;
  v_bill record;
  v_remaining numeric;
  v_outstanding numeric;
  v_apply numeric;
  v_applied_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT * INTO v_claim FROM public.resident_payment_claims c WHERE c.id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF v_claim.status = 'approved' THEN RETURN v_claim.payment_id; END IF;
  IF v_claim.status <> 'pending' THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;

  -- Migration 067. A levy claim must never reach this function. It would see
  -- zero bill_ids, take the undirected branch below, appropriate the money
  -- across maintenance bills and book any remainder as an unapplied advance —
  -- while the levy assessment the resident actually paid stays outstanding.
  -- The route already branches on levy_assessment_ids; this makes a caller
  -- that forgets fail loudly instead of silently misrouting money.
  IF cardinality(v_claim.levy_assessment_ids) > 0 THEN
    RAISE EXCEPTION 'CLAIM_IS_LEVY_CLAIM';
  END IF;

  IF cardinality(v_claim.bill_ids) > 0 THEN
    -- DIRECTED (Contract Act s.59): the resident named the months, so honour
    -- exactly those. Unchanged from migration 061 — same exact-total contract,
    -- same helper. assert_payable_bills is deliberately NOT relaxed to tolerate
    -- an empty array, because confirm_resident_payment still needs it strict.
    PERFORM public.assert_payable_bills(v_claim.society_id, v_claim.unit_id, v_claim.bill_ids, v_claim.amount);

    INSERT INTO public.payments (
      unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
      utr_reference, months_covered, notes, unapplied_amount
    ) VALUES (
      v_claim.unit_id, v_claim.society_id, v_claim.bill_ids, v_claim.amount,
      (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'MANUAL_COLLECTION' END)::public.payment_mode,
      coalesce(v_claim.paid_on, current_date), v_claim.utr_reference, 0,
      'Approved from uploaded payment proof', 0
    ) RETURNING id INTO v_payment_id;

    UPDATE public.bills SET status = 'PAID', amount_settled = payable_amount
    WHERE id = ANY(v_claim.bill_ids) AND society_id = v_claim.society_id AND unit_id = v_claim.unit_id;
  ELSE
    -- UNDIRECTED (Contract Act s.61): no months named, so discharge in order of
    -- time, oldest first, and park any surplus as unapplied. Ordering and the
    -- greedy walk mirror src/lib/utils/appropriation.ts, which computes the
    -- same split for the preview the treasurer approves against; the RLS
    -- integration test asserts the two agree. The loop is authoritative because
    -- it holds FOR UPDATE on every bill it touches.
    v_remaining := v_claim.amount;

    FOR v_bill IN
      SELECT b.id, b.payable_amount, b.amount_settled
      FROM public.bills b
      WHERE b.society_id = v_claim.society_id
        AND b.unit_id = v_claim.unit_id
        AND b.is_voided = false
        AND b.status IN ('ISSUED', 'OVERDUE')
      ORDER BY b.bill_period_year, b.bill_period_month, b.id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0.005;
      v_outstanding := GREATEST(0, v_bill.payable_amount - v_bill.amount_settled);
      CONTINUE WHEN v_outstanding <= 0.005;

      v_apply := LEAST(v_outstanding, v_remaining);
      UPDATE public.bills
        SET amount_settled = amount_settled + v_apply,
            status = CASE WHEN amount_settled + v_apply >= payable_amount - 0.005
                          THEN 'PAID' ELSE status END
        WHERE id = v_bill.id;

      v_applied_ids := array_append(v_applied_ids, v_bill.id);
      v_remaining := v_remaining - v_apply;
    END LOOP;

    -- The payment keeps its real method. Only unapplied_amount records that part
    -- of it is not yet allocated, so it counts in the collections breakdown AND
    -- appears on /advances until settled.
    INSERT INTO public.payments (
      unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
      utr_reference, months_covered, notes, unapplied_amount
    ) VALUES (
      v_claim.unit_id, v_claim.society_id, v_applied_ids, v_claim.amount,
      (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'MANUAL_COLLECTION' END)::public.payment_mode,
      coalesce(v_claim.paid_on, current_date), v_claim.utr_reference, 0,
      CASE WHEN cardinality(v_applied_ids) = 0
           THEN 'Approved from uploaded payment proof — unallocated, awaiting settlement'
           ELSE 'Approved from uploaded payment proof — applied to oldest dues first' END,
      GREATEST(0, v_remaining)
    ) RETURNING id INTO v_payment_id;
  END IF;

  UPDATE public.resident_payment_claims
    SET status = 'approved', payment_id = v_payment_id,
        reviewed_by = p_reviewer_id, reviewed_at = now()
    WHERE id = v_claim.id;

  RETURN v_payment_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
