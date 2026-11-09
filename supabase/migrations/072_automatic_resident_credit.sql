-- Automatic resident credit.
DROP INDEX IF EXISTS public.advance_settlements_one_per_bill;
CREATE UNIQUE INDEX IF NOT EXISTS advance_settlements_one_per_payment_bill
  ON public.advance_settlements (advance_id, bill_id)
  WHERE advance_kind = 'PAYMENT' AND bill_id IS NOT NULL AND is_voided = false;

-- A directed short payment may be intentionally held for the named month; it
-- must not be silently redirected to some other debt. Keep that legal fact
-- separate from the numeric balance rather than inferring it from bill_ids.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS auto_apply_credit boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payments.auto_apply_credit IS
  'Whether unapplied_amount is undirected account credit that may automatically discharge this unit''s oldest payable maintenance bill.';

UPDATE public.payments p SET auto_apply_credit = true
WHERE p.is_voided = false AND p.unapplied_amount > 0.005
  AND (
    p.payment_mode = 'ADVANCE'
    OR (
      NULLIF(trim(COALESCE(p.months_detail, '')), '') IS NULL
      AND COALESCE(p.notes, '') NOT ILIKE '%reconciliation required%'
    )
  );

CREATE INDEX IF NOT EXISTS idx_payments_unapplied_fifo
  ON public.payments (society_id, unit_id, payment_date, created_at, id)
  WHERE is_voided = false AND auto_apply_credit = true AND unapplied_amount > 0.005;

CREATE INDEX IF NOT EXISTS idx_bills_payable_fifo
  ON public.bills (society_id, unit_id, bill_period_year, bill_period_month, id)
  WHERE is_voided = false AND status IN ('ISSUED', 'OVERDUE');

CREATE OR REPLACE FUNCTION private.apply_unit_payment_credit(
  p_society_id uuid,
  p_unit_id uuid,
  p_settled_date date DEFAULT current_date
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_bill record;
  v_payment record;
  v_outstanding numeric;
  v_apply numeric;
  v_total_applied numeric := 0;
  v_credit_found boolean;
BEGIN
  IF p_society_id IS NULL OR p_unit_id IS NULL THEN
    RETURN 0;
  END IF;

  -- The same unit lock used by resident claim submission. It prevents a new
  -- bill and a new receipt racing to spend the same paise of credit.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_unit_id::text, 0));

  FOR v_bill IN
    SELECT b.id, b.bill_period_year, b.bill_period_month,
           b.payable_amount, b.amount_settled, b.due_date
    FROM public.bills b
    WHERE b.society_id = p_society_id
      AND b.unit_id = p_unit_id
      AND b.is_voided = false
      AND b.status IN ('ISSUED', 'OVERDUE')
      AND b.payable_amount - b.amount_settled > 0.005
    ORDER BY b.bill_period_year, b.bill_period_month, b.id
    FOR UPDATE
  LOOP
    v_outstanding := GREATEST(0, v_bill.payable_amount - v_bill.amount_settled);
    v_credit_found := false;

    WHILE v_outstanding > 0.005 LOOP
      SELECT p.id, p.unapplied_amount
      INTO v_payment
      FROM public.payments p
      WHERE p.society_id = p_society_id
        AND p.unit_id = p_unit_id
        AND p.is_voided = false
        AND p.auto_apply_credit = true
        AND p.unapplied_amount > 0.005
      ORDER BY p.payment_date, p.created_at, p.id
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        EXIT;
      END IF;
      v_credit_found := true;
      v_apply := LEAST(v_outstanding, v_payment.unapplied_amount);

      UPDATE public.payments p
      SET unapplied_amount = GREATEST(0, p.unapplied_amount - v_apply),
          bill_ids = CASE
            WHEN v_bill.id = ANY(COALESCE(p.bill_ids, '{}'::uuid[])) THEN p.bill_ids
            ELSE array_append(COALESCE(p.bill_ids, '{}'::uuid[]), v_bill.id)
          END
      WHERE p.id = v_payment.id;

      UPDATE public.bills b
      SET amount_settled = b.amount_settled + v_apply,
          status = CASE
            WHEN b.amount_settled + v_apply >= b.payable_amount - 0.005
              THEN 'PAID'::public.bill_status
            ELSE b.status
          END
      WHERE b.id = v_bill.id;

      INSERT INTO public.advance_settlements (
        society_id, advance_kind, advance_id, settled_amount,
        settled_against, settled_date, notes, bill_id
      ) VALUES (
        p_society_id, 'PAYMENT', v_payment.id, v_apply,
        to_char(make_date(v_bill.bill_period_year, v_bill.bill_period_month, 1), 'Mon YYYY') || ' maintenance bill',
        COALESCE(p_settled_date, current_date),
        'Automatically applied from resident account credit',
        v_bill.id
      );

      v_total_applied := v_total_applied + v_apply;
      v_outstanding := v_outstanding - v_apply;
    END LOOP;

    EXIT WHEN NOT v_credit_found;
  END LOOP;

  RETURN round(v_total_applied, 2);
END;
$$;

REVOKE ALL ON FUNCTION private.apply_unit_payment_credit(uuid, uuid, date)
  FROM PUBLIC, anon, authenticated;

-- Existing manual-recording callers predate auto_apply_credit. Absence of a
-- named month is the direction signal they already pass to record_manual_payment;
-- classify only those new unapplied receipts, never a directed short payment or
-- an unresolved gateway reconciliation row.
CREATE OR REPLACE FUNCTION private.classify_undirected_payment_credit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.unapplied_amount > 0.005
    AND NEW.auto_apply_credit = false
    AND (
      NEW.payment_mode = 'ADVANCE'
      OR (
        NULLIF(trim(COALESCE(NEW.months_detail, '')), '') IS NULL
        AND COALESCE(NEW.notes, '') NOT ILIKE '%reconciliation required%'
      )
    )
  THEN
    NEW.auto_apply_credit := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_classify_undirected_payment_credit ON public.payments;
CREATE TRIGGER trg_classify_undirected_payment_credit
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION private.classify_undirected_payment_credit();

REVOKE ALL ON FUNCTION private.classify_undirected_payment_credit()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.apply_payment_credit_after_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.is_voided = false AND NEW.unapplied_amount > 0.005 THEN
    IF TG_OP = 'INSERT'
       OR OLD.is_voided = true
       OR NEW.unapplied_amount > OLD.unapplied_amount + 0.005
    THEN
      PERFORM private.apply_unit_payment_credit(NEW.society_id, NEW.unit_id, current_date);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.apply_payment_credit_after_payment_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_apply_payment_credit_after_payment_change ON public.payments;
CREATE TRIGGER trg_apply_payment_credit_after_payment_change
  AFTER INSERT OR UPDATE OF unapplied_amount, is_voided ON public.payments
  FOR EACH ROW EXECUTE FUNCTION private.apply_payment_credit_after_payment_change();

CREATE OR REPLACE FUNCTION private.apply_payment_credit_after_bill_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.is_voided = false AND NEW.status IN ('ISSUED', 'OVERDUE') THEN
    IF TG_OP = 'INSERT'
       OR OLD.is_voided = true
       OR OLD.status NOT IN ('ISSUED', 'OVERDUE')
       OR NEW.payable_amount > OLD.payable_amount + 0.005
    THEN
      PERFORM private.apply_unit_payment_credit(NEW.society_id, NEW.unit_id, current_date);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.apply_payment_credit_after_bill_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_apply_payment_credit_after_bill_change ON public.bills;
CREATE TRIGGER trg_apply_payment_credit_after_bill_change
  AFTER INSERT OR UPDATE OF status, base_amount, previous_due, penalty_amount,
    cheque_dishonour, is_voided ON public.bills
  FOR EACH ROW EXECUTE FUNCTION private.apply_payment_credit_after_bill_change();

-- New undirected resident receipts enter the bucket at their full amount. The
-- payment trigger above performs the authoritative oldest-first allocation and
-- records the per-bill settlement trail; approval no longer duplicates that
-- greedy loop in a second function.
CREATE OR REPLACE FUNCTION public.approve_resident_payment_claim(
  p_claim_id uuid, p_reviewer_id uuid, p_method text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
#variable_conflict use_column
DECLARE
  v_claim public.resident_payment_claims%ROWTYPE;
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_claim FROM public.resident_payment_claims c WHERE c.id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF v_claim.status = 'approved' THEN RETURN v_claim.payment_id; END IF;
  IF v_claim.status <> 'pending' THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;
  IF cardinality(v_claim.levy_assessment_ids) > 0 THEN RAISE EXCEPTION 'CLAIM_IS_LEVY_CLAIM'; END IF;

  IF cardinality(v_claim.bill_ids) > 0 THEN
    -- Directed payment (Contract Act s.59): named months must still match and
    -- settle exactly. Surplus payments use the undirected bucket path instead.
    PERFORM public.assert_payable_bills(
      v_claim.society_id, v_claim.unit_id, v_claim.bill_ids, v_claim.amount
    );
    INSERT INTO public.payments (
      unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
      utr_reference, months_covered, notes, unapplied_amount, auto_apply_credit
    ) VALUES (
      v_claim.unit_id, v_claim.society_id, v_claim.bill_ids, v_claim.amount,
      (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'MANUAL_COLLECTION' END)::public.payment_mode,
      coalesce(v_claim.paid_on, current_date), v_claim.utr_reference,
      cardinality(v_claim.bill_ids), 'Approved from uploaded payment proof', 0, false
    ) RETURNING id INTO v_payment_id;

    UPDATE public.bills SET status = 'PAID', amount_settled = payable_amount
    WHERE id = ANY(v_claim.bill_ids)
      AND society_id = v_claim.society_id AND unit_id = v_claim.unit_id;
  ELSE
    INSERT INTO public.payments (
      unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
      utr_reference, months_covered, notes, unapplied_amount, auto_apply_credit
    ) VALUES (
      v_claim.unit_id, v_claim.society_id, '{}'::uuid[], v_claim.amount,
      (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'MANUAL_COLLECTION' END)::public.payment_mode,
      coalesce(v_claim.paid_on, current_date), v_claim.utr_reference, 0,
      'Approved from uploaded payment proof — account credit applied oldest first',
      v_claim.amount, true
    ) RETURNING id INTO v_payment_id;
    -- The AFTER INSERT trigger consumes what current bills can take and leaves
    -- only the genuine bucket balance in unapplied_amount.
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

-- Manual allocation remains available for an operator exception. Fix its
-- remaining-balance calculation: payments.unapplied_amount is already the
-- current remainder, so subtracting historical settlements from it a second
-- time rejected valid allocations after the first draw.
CREATE OR REPLACE FUNCTION public.create_advance_settlement(
  p_society_id uuid, p_advance_kind text, p_advance_id uuid,
  p_settled_amount numeric, p_settled_against text, p_settled_date date,
  p_notes text DEFAULT NULL, p_bill_id uuid DEFAULT NULL
)
RETURNS public.advance_settlements LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_available numeric;
  v_already_settled numeric;
  v_settlement public.advance_settlements;
  v_bill public.bills%ROWTYPE;
  v_unit_id uuid;
BEGIN
  IF p_society_id IS NULL OR (SELECT auth.uid()) IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  IF p_advance_id IS NULL OR p_advance_kind NOT IN ('PAYMENT', 'EXPENSE')
    OR p_settled_amount IS NULL OR p_settled_amount <= 0 OR p_settled_amount > 500000
    OR p_settled_amount::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_settled_date IS NULL OR p_settled_date NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-31'
    OR p_settled_against IS NULL OR char_length(trim(p_settled_against)) NOT BETWEEN 3 AND 300
    OR char_length(COALESCE(p_notes, '')) > 500
  THEN RAISE EXCEPTION 'INVALID_SETTLEMENT'; END IF;

  IF p_advance_kind = 'PAYMENT' THEN
    SELECT p.unapplied_amount, p.unit_id INTO v_available, v_unit_id
    FROM public.payments p
    WHERE p.id = p_advance_id AND p.society_id = p_society_id
      AND p.is_voided = false AND p.unapplied_amount > 0.005
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_ADVANCE_NOT_FOUND'; END IF;
  ELSE
    SELECT e.amount INTO v_available FROM public.expenditures e
    WHERE e.id = p_advance_id AND e.society_id = p_society_id
      AND e.is_voided = false AND e.category = 'ADVANCE_PAYMENT'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_ADVANCE_NOT_FOUND'; END IF;
    IF p_bill_id IS NOT NULL THEN RAISE EXCEPTION 'EXPENSE_ADVANCE_HAS_NO_BILL'; END IF;
    SELECT COALESCE(SUM(s.settled_amount), 0) INTO v_already_settled
    FROM public.advance_settlements s
    WHERE s.society_id = p_society_id AND s.advance_kind = 'EXPENSE'
      AND s.advance_id = p_advance_id AND s.is_voided = false;
    v_available := v_available - v_already_settled;
  END IF;

  IF p_settled_amount > v_available + 0.005 THEN
    RAISE EXCEPTION 'SETTLEMENT_EXCEEDS_REMAINING';
  END IF;

  IF p_bill_id IS NOT NULL THEN
    SELECT * INTO v_bill FROM public.bills b
    WHERE b.id = p_bill_id AND b.society_id = p_society_id AND b.is_voided = false
    FOR UPDATE;
    IF v_bill.id IS NULL THEN RAISE EXCEPTION 'BILL_NOT_FOUND'; END IF;
    IF v_bill.status = 'PAID' THEN RAISE EXCEPTION 'BILL_ALREADY_PAID'; END IF;
    IF v_bill.status NOT IN ('ISSUED', 'OVERDUE') THEN RAISE EXCEPTION 'BILL_NOT_PAYABLE'; END IF;
    IF v_unit_id IS DISTINCT FROM v_bill.unit_id THEN RAISE EXCEPTION 'BILL_UNIT_MISMATCH'; END IF;
    IF p_settled_amount > v_bill.payable_amount - v_bill.amount_settled + 0.005 THEN
      RAISE EXCEPTION 'SETTLEMENT_EXCEEDS_BILL';
    END IF;

    UPDATE public.bills b SET
      amount_settled = b.amount_settled + p_settled_amount,
      status = CASE WHEN b.amount_settled + p_settled_amount >= b.payable_amount - 0.005
                    THEN 'PAID'::public.bill_status ELSE b.status END
    WHERE b.id = p_bill_id;
  END IF;

  IF p_advance_kind = 'PAYMENT' THEN
    UPDATE public.payments p
    SET unapplied_amount = GREATEST(0, p.unapplied_amount - p_settled_amount),
        bill_ids = CASE
          WHEN p_bill_id IS NULL OR p_bill_id = ANY(COALESCE(p.bill_ids, '{}'::uuid[])) THEN p.bill_ids
          ELSE array_append(COALESCE(p.bill_ids, '{}'::uuid[]), p_bill_id)
        END
    WHERE p.id = p_advance_id;
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

REVOKE ALL ON FUNCTION public.create_advance_settlement(uuid, text, uuid, numeric, text, date, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_advance_settlement(uuid, text, uuid, numeric, text, date, text, uuid)
  TO authenticated;

-- Voiding a settlement must put the paise back and reopen the bill in the same
-- transaction. With automatic allocation the restored credit may immediately
-- pay the oldest outstanding bill again, which is the correct bucket outcome.
CREATE OR REPLACE FUNCTION public.void_advance_settlement(
  p_society_id uuid, p_settlement_id uuid, p_reason text
)
RETURNS public.advance_settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_settlement public.advance_settlements%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_bill public.bills%ROWTYPE;
BEGIN
  IF p_society_id IS NULL OR (SELECT auth.uid()) IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_reason IS NULL OR char_length(trim(p_reason)) NOT BETWEEN 3 AND 500
  THEN RAISE EXCEPTION 'INVALID_VOID_REASON'; END IF;

  SELECT * INTO v_settlement FROM public.advance_settlements s
  WHERE s.id = p_settlement_id AND s.society_id = p_society_id AND s.is_voided = false
  FOR UPDATE;
  IF v_settlement.id IS NULL THEN RAISE EXCEPTION 'SETTLEMENT_NOT_ACTIVE'; END IF;

  UPDATE public.advance_settlements SET
    is_voided = true, void_reason = trim(p_reason), voided_at = now()
  WHERE id = v_settlement.id RETURNING * INTO v_settlement;

  IF v_settlement.advance_kind = 'PAYMENT' THEN
    SELECT * INTO v_payment FROM public.payments p
    WHERE p.id = v_settlement.advance_id AND p.society_id = p_society_id
    FOR UPDATE;

    IF v_settlement.bill_id IS NOT NULL THEN
      SELECT * INTO v_bill FROM public.bills b
      WHERE b.id = v_settlement.bill_id AND b.society_id = p_society_id
      FOR UPDATE;
      IF v_bill.id IS NOT NULL AND v_bill.is_voided = false THEN
        UPDATE public.bills b SET
          amount_settled = GREATEST(0, b.amount_settled - v_settlement.settled_amount),
          status = CASE
            WHEN GREATEST(0, b.amount_settled - v_settlement.settled_amount) >= b.payable_amount - 0.005
              THEN 'PAID'::public.bill_status
            WHEN b.due_date < current_date THEN 'OVERDUE'::public.bill_status
            ELSE 'ISSUED'::public.bill_status
          END
        WHERE b.id = v_bill.id;
      END IF;
    END IF;

    IF v_payment.id IS NOT NULL AND v_payment.is_voided = false THEN
      UPDATE public.payments p SET
        unapplied_amount = LEAST(p.amount_paid, p.unapplied_amount + v_settlement.settled_amount)
      WHERE p.id = v_payment.id;
    END IF;
  END IF;

  RETURN v_settlement;
END;
$$;

REVOKE ALL ON FUNCTION public.void_advance_settlement(uuid, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.void_advance_settlement(uuid, uuid, text)
  TO authenticated;

-- A whole-payment void also voids and reverses every automatic bucket draw.
-- Older direct allocations keep their established reversal path.
CREATE OR REPLACE FUNCTION public.void_payment_transactional(
  p_payment_id uuid, p_society_id uuid, p_actor_id uuid, p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_auto record;
  v_auto_bill_ids uuid[] := '{}'::uuid[];
BEGIN
  SELECT * INTO v_payment FROM public.payments p
  WHERE p.id = p_payment_id AND p.society_id = p_society_id FOR UPDATE;
  IF NOT FOUND OR v_payment.is_voided THEN RAISE EXCEPTION 'PAYMENT_NOT_ACTIVE'; END IF;

  PERFORM 1 FROM public.advance_settlements s
  WHERE s.society_id = p_society_id AND s.advance_kind = 'PAYMENT'
    AND s.advance_id = v_payment.id AND s.is_voided = false
  FOR UPDATE;

  UPDATE public.payments SET
    is_voided = true, void_reason = p_reason,
    voided_by = p_actor_id::text, voided_at = now()
  WHERE id = v_payment.id;

  FOR v_auto IN
    SELECT s.bill_id, SUM(s.settled_amount) AS settled_amount
    FROM public.advance_settlements s
    WHERE s.society_id = p_society_id AND s.advance_kind = 'PAYMENT'
      AND s.advance_id = v_payment.id AND s.is_voided = false
      AND s.bill_id IS NOT NULL
    GROUP BY s.bill_id
  LOOP
    v_auto_bill_ids := array_append(v_auto_bill_ids, v_auto.bill_id);
    UPDATE public.bills b SET
      amount_settled = GREATEST(0, b.amount_settled - v_auto.settled_amount),
      status = CASE
        WHEN GREATEST(0, b.amount_settled - v_auto.settled_amount) >= b.payable_amount - 0.005
          THEN 'PAID'::public.bill_status
        WHEN b.due_date < current_date THEN 'OVERDUE'::public.bill_status
        ELSE 'ISSUED'::public.bill_status
      END
    WHERE b.id = v_auto.bill_id AND b.society_id = p_society_id AND b.is_voided = false;
  END LOOP;

  UPDATE public.advance_settlements SET
    is_voided = true,
    void_reason = 'Source payment voided: ' || COALESCE(NULLIF(trim(p_reason), ''), 'No reason supplied'),
    voided_at = now()
  WHERE society_id = p_society_id AND advance_kind = 'PAYMENT'
    AND advance_id = v_payment.id AND is_voided = false;

  IF cardinality(v_payment.bill_ids) > 0 THEN
    PERFORM 1 FROM public.bills b
    WHERE b.id = ANY(v_payment.bill_ids) AND b.society_id = v_payment.society_id
      AND b.unit_id = v_payment.unit_id FOR UPDATE;

    UPDATE public.bills b SET
      status = CASE WHEN b.due_date < current_date
                    THEN 'OVERDUE'::public.bill_status ELSE 'ISSUED'::public.bill_status END,
      amount_settled = COALESCE((
        SELECT SUM(s.settled_amount) FROM public.advance_settlements s
        WHERE s.bill_id = b.id AND s.is_voided = false
      ), 0)
    WHERE b.id = ANY(v_payment.bill_ids)
      AND NOT (b.id = ANY(v_auto_bill_ids))
      AND b.society_id = v_payment.society_id AND b.unit_id = v_payment.unit_id
      AND b.is_voided = false AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.id <> v_payment.id AND p.is_voided = false AND b.id = ANY(p.bill_ids)
      );
  END IF;
END;
$$;

-- Apply every pre-existing bucket balance immediately. This is idempotent: a
-- second run finds either no credit or no outstanding bill.
DO $$
DECLARE v_unit record;
BEGIN
  FOR v_unit IN
    SELECT DISTINCT p.society_id, p.unit_id
    FROM public.payments p
    WHERE p.is_voided = false AND p.auto_apply_credit = true AND p.unapplied_amount > 0.005
    ORDER BY p.society_id, p.unit_id
  LOOP
    PERFORM private.apply_unit_payment_credit(v_unit.society_id, v_unit.unit_id, current_date);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
