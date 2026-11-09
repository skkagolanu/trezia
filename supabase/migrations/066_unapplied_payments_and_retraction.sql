-- Unapplied payments and retraction.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS unapplied_amount numeric NOT NULL DEFAULT 0
    CHECK (unapplied_amount >= 0);

-- Upper bound (unapplied_amount <= amount_paid) is enforced in the RPCs where
-- the row is locked, not as a table CHECK: payments.amount_paid is written by
-- several existing paths and a table-level cross-column constraint would reject
-- historical rows during backfill rather than failing loudly at the write site.

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS amount_settled numeric NOT NULL DEFAULT 0
    CHECK (amount_settled >= 0);

COMMENT ON COLUMN public.payments.unapplied_amount IS
  'Portion of amount_paid not yet applied to any bill. applied + unapplied = amount_paid. Surfaced on /advances regardless of payment_mode.';
COMMENT ON COLUMN public.bills.amount_settled IS
  'Cumulative amount applied to this bill. status becomes PAID when amount_settled >= payable_amount. Enables partial settlement, which oldest-first appropriation requires.';

-- Backfill so history stays consistent with the new invariants.
-- A bill already marked PAID is fully settled by definition.
UPDATE public.bills SET amount_settled = payable_amount
  WHERE status = 'PAID' AND amount_settled = 0;

-- Legacy advances: whatever has not been settled through the advances ledger is
-- still unapplied. This preserves the current /advances contents exactly, so the
-- page shows the same rows before and after this migration.
UPDATE public.payments p SET unapplied_amount = GREATEST(0, p.amount_paid - COALESCE((
  SELECT SUM(s.settled_amount) FROM public.advance_settlements s
  WHERE s.advance_kind = 'PAYMENT' AND s.advance_id = p.id AND s.is_voided = false
), 0))
WHERE p.payment_mode = 'ADVANCE' AND p.is_voided = false;

-- ---------------------------------------------------------------------------
-- 2. Claim retraction state
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_constraint text;
BEGIN
  -- Read the name rather than assuming it: migration 059 declared the CHECK
  -- inline, so the name is whatever Postgres generated.
  SELECT con.conname INTO v_constraint
  FROM pg_constraint con
  WHERE con.conrelid = 'public.resident_payment_claims'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.resident_payment_claims DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

ALTER TABLE public.resident_payment_claims
  ADD CONSTRAINT resident_payment_claims_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'retracted'));

-- ---------------------------------------------------------------------------
-- 2b. Duplicate-submission guardrails
-- ---------------------------------------------------------------------------

-- validateAttachment() already computes this digest and the claim route was
-- throwing it away. Persisting it makes a byte-identical re-upload detectable.
ALTER TABLE public.resident_payment_claims
  ADD COLUMN IF NOT EXISTS screenshot_sha256 text;

-- Scoped to pending/approved ON PURPOSE. A rejected claim is very often
-- re-submitted with the SAME screenshot and a corrected amount — that is the
-- treasurer asking for a fix, not a duplicate — so blocking on the digest
-- outright would punish the honest correction path. Retracted claims are
-- excluded for the same reason.
CREATE UNIQUE INDEX IF NOT EXISTS resident_payment_claims_unique_screenshot
  ON public.resident_payment_claims (society_id, screenshot_sha256)
  WHERE screenshot_sha256 IS NOT NULL AND status IN ('pending', 'approved');

-- A bank UTR identifies one real transaction, so the same reference appearing
-- twice in one society is a strong duplicate signal rather than a coincidence.
CREATE UNIQUE INDEX IF NOT EXISTS resident_payment_claims_unique_utr
  ON public.resident_payment_claims (society_id, utr_reference)
  WHERE utr_reference IS NOT NULL AND status IN ('pending', 'approved');

-- ---------------------------------------------------------------------------
-- 3. Advance settlements link to the bill they actually pay
-- ---------------------------------------------------------------------------

ALTER TABLE public.advance_settlements
  ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES public.bills(id);

-- Legacy rows keep bill_id NULL. Free text like 'May 2026 maintenance bill'
-- cannot be resolved to a specific bills.id with confidence, and guessing would
-- fabricate financial links inside an audit ledger.
COMMENT ON COLUMN public.advance_settlements.bill_id IS
  'The bill this settlement pays. NULL on rows predating migration 066 and on EXPENSE-kind settlements, which point at expenditures rather than bills.';

-- One live settlement per bill. The system has no partial-bill concept beyond
-- amount_settled, and a second settlement against the same bill is the
-- double-credit this migration exists to prevent.
CREATE UNIQUE INDEX IF NOT EXISTS advance_settlements_one_per_bill
  ON public.advance_settlements (bill_id)
  WHERE bill_id IS NOT NULL AND is_voided = false;

-- Migration 027 shipped `FOR ALL TO authenticated USING (true) WITH CHECK (true)`,
-- which is unscoped: any authenticated user of any society could read and write
-- this ledger. Replace it with the same finance-capability scope every other
-- financial table uses. Reads only — writes go through the RPC below.
DROP POLICY IF EXISTS "advance_settlements_authenticated_all" ON public.advance_settlements;
DROP POLICY IF EXISTS advance_settlements_finance_read ON public.advance_settlements;
CREATE POLICY advance_settlements_finance_read ON public.advance_settlements
  FOR SELECT TO authenticated
  USING (private.auth_society_finance(society_id));

-- ---------------------------------------------------------------------------
-- 4. Claim submission — accept a claim with no bills (an advance)
-- ---------------------------------------------------------------------------

-- p_screenshot_sha256 is appended with a DEFAULT so every existing caller keeps
-- working unchanged; the route passes it once wired.
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
    AND status <> 'PAID';


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

-- ---------------------------------------------------------------------------
-- 5. Claim approval — exact-total for directed claims, appropriation otherwise
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

-- ---------------------------------------------------------------------------
-- 6. Retraction by the resident who submitted it
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.retract_resident_payment_claim(
  p_claim_id uuid, p_unit_id uuid, p_user_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
#variable_conflict use_column
DECLARE v_claim public.resident_payment_claims%ROWTYPE;
BEGIN
  -- Same FOR UPDATE discipline as approve/reject, so a retraction racing an
  -- approval resolves deterministically: whichever transaction takes the row
  -- lock first wins and the loser sees the updated status below.
  SELECT * INTO v_claim FROM public.resident_payment_claims c WHERE c.id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;

  -- p_unit_id comes from the caller's authenticated membership, never request
  -- data. Re-checked here because resident_payment_claims has no client write
  -- policy at all, making this RPC the only enforcement point.
  IF v_claim.unit_id IS DISTINCT FROM p_unit_id THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF v_claim.status <> 'pending' THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;

  -- Terminal state, not a delete. The screenshot object is deliberately kept:
  -- a withdrawn claim remains part of the audit trail, and storage rules say to
  -- preserve source objects unless deletion is the authorised workflow.
  UPDATE public.resident_payment_claims
    SET status = 'retracted',
        review_note = 'Withdrawn by the resident',
        reviewed_by = p_user_id,
        reviewed_at = now()
    WHERE id = v_claim.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Advance settlement actually settles the bill
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_advance_settlement(
  p_society_id uuid, p_advance_kind text, p_advance_id uuid,
  p_settled_amount numeric, p_settled_against text, p_settled_date date,
  p_notes text DEFAULT NULL, p_bill_id uuid DEFAULT NULL
)
RETURNS public.advance_settlements LANGUAGE plpgsql SECURITY DEFINER
-- Not `search_path = ''` as in migration 051. This version now UPDATEs
-- public.bills and public.payments, and a trigger inherits the calling
-- function's search_path — the audit, updated_at and payment-hash triggers all
-- use unqualified names, so an empty path makes them fail to resolve
-- ("relation audit_log does not exist"). Same fixed, non-attacker-controllable
-- path the claim RPCs use; every statement below is still schema-qualified.
SET search_path = public, extensions AS $$
DECLARE
  v_original_amount numeric;
  v_already_settled numeric;
  v_settlement public.advance_settlements;
  v_bill record;
  v_unit_id uuid;
BEGIN
  IF p_society_id IS NULL
    OR (SELECT auth.uid()) IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_advance_id IS NULL
    OR p_advance_kind IS NULL
    OR p_advance_kind NOT IN ('PAYMENT', 'EXPENSE')
    OR p_settled_amount IS NULL
    OR p_settled_amount <= 0
    OR p_settled_amount > 500000
    OR p_settled_amount::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_settled_date IS NULL
    OR p_settled_date NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-31'
    OR p_settled_against IS NULL
    OR char_length(trim(p_settled_against)) NOT BETWEEN 3 AND 300
    OR char_length(COALESCE(p_notes, '')) > 500
  THEN
    RAISE EXCEPTION 'INVALID_SETTLEMENT';
  END IF;

  IF p_advance_kind = 'PAYMENT' THEN
    -- Eligibility is now "has an unapplied balance" rather than
    -- payment_mode = 'ADVANCE'. That old filter is what hid a resident's
    -- unallocated UPI payment, and the reconciliation_required rows that
    -- confirm_resident_payment writes with empty bill_ids, from this ledger.
    SELECT p.unapplied_amount, p.unit_id
    INTO v_original_amount, v_unit_id
    FROM public.payments p
    WHERE p.id = p_advance_id
      AND p.society_id = p_society_id
      AND p.is_voided = false
      AND (p.unapplied_amount > 0 OR p.payment_mode = 'ADVANCE')
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_ADVANCE_NOT_FOUND'; END IF;
  ELSE
    SELECT e.amount INTO v_original_amount
    FROM public.expenditures e
    WHERE e.id = p_advance_id AND e.society_id = p_society_id
      AND e.is_voided = false AND e.category = 'ADVANCE_PAYMENT'
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_ADVANCE_NOT_FOUND'; END IF;
    IF p_bill_id IS NOT NULL THEN RAISE EXCEPTION 'EXPENSE_ADVANCE_HAS_NO_BILL'; END IF;
  END IF;

  SELECT COALESCE(SUM(s.settled_amount), 0) INTO v_already_settled
  FROM public.advance_settlements s
  WHERE s.society_id = p_society_id AND s.advance_kind = p_advance_kind
    AND s.advance_id = p_advance_id AND s.is_voided = false;

  IF p_settled_amount > v_original_amount - v_already_settled THEN
    RAISE EXCEPTION 'SETTLEMENT_EXCEEDS_REMAINING';
  END IF;

  -- Settling against a bill now PAYS that bill inside this transaction, rather
  -- than recording prose about it. Without this the same bill could be credited
  -- here and again by a recorded payment.
  IF p_bill_id IS NOT NULL THEN
    SELECT b.id, b.payable_amount, b.amount_settled, b.unit_id, b.status
    INTO v_bill
    FROM public.bills b
    WHERE b.id = p_bill_id AND b.society_id = p_society_id AND b.is_voided = false
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'BILL_NOT_FOUND'; END IF;
    IF v_bill.status = 'PAID' THEN RAISE EXCEPTION 'BILL_ALREADY_PAID'; END IF;
    -- The advance belongs to one flat; it cannot pay another flat's dues.
    IF v_unit_id IS DISTINCT FROM v_bill.unit_id THEN RAISE EXCEPTION 'BILL_UNIT_MISMATCH'; END IF;
    IF p_settled_amount > v_bill.payable_amount - v_bill.amount_settled + 0.005 THEN
      RAISE EXCEPTION 'SETTLEMENT_EXCEEDS_BILL';
    END IF;

    UPDATE public.bills
      SET amount_settled = amount_settled + p_settled_amount,
          status = CASE WHEN amount_settled + p_settled_amount >= payable_amount - 0.005
                        THEN 'PAID' ELSE status END
      WHERE id = p_bill_id;
  END IF;

  IF p_advance_kind = 'PAYMENT' THEN
    UPDATE public.payments
      SET unapplied_amount = GREATEST(0, unapplied_amount - p_settled_amount)
      WHERE id = p_advance_id;
  END IF;

  INSERT INTO public.advance_settlements (
    society_id, advance_kind, advance_id, settled_amount, settled_against,
    settled_date, notes, bill_id
  ) VALUES (
    p_society_id, p_advance_kind, p_advance_id, p_settled_amount,
    trim(p_settled_against), p_settled_date, NULLIF(trim(p_notes), ''), p_bill_id
  ) RETURNING * INTO v_settlement;

  RETURN v_settlement;
END;
$$;

-- The 7-argument signature is replaced by the 8-argument one above; drop the old
-- overload so PostgREST cannot resolve a call to a stale definition that would
-- skip the bill locking.
DROP FUNCTION IF EXISTS public.create_advance_settlement(uuid, text, uuid, numeric, text, date, text);

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.submit_resident_payment_claim(uuid, uuid, uuid[], numeric, text, date, text, uuid, text) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.submit_resident_payment_claim(uuid, uuid, uuid[], numeric, text, date, text, uuid);
GRANT EXECUTE ON FUNCTION public.submit_resident_payment_claim(uuid, uuid, uuid[], numeric, text, date, text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.approve_resident_payment_claim(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_resident_payment_claim(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.retract_resident_payment_claim(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retract_resident_payment_claim(uuid, uuid, uuid) TO service_role;

-- create_advance_settlement stays callable by the signed-in operator, matching
-- migration 051 — it authorises via private.auth_society_finance() internally.
REVOKE ALL ON FUNCTION public.create_advance_settlement(uuid, text, uuid, numeric, text, date, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_advance_settlement(uuid, text, uuid, numeric, text, date, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
