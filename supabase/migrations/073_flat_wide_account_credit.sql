-- Flat wide account credit.

ALTER TABLE public.advance_settlements
  ADD COLUMN IF NOT EXISTS levy_assessment_id uuid
    REFERENCES public.levy_assessments(id);

ALTER TABLE public.advance_settlements
  DROP CONSTRAINT IF EXISTS advance_settlements_one_obligation;
ALTER TABLE public.advance_settlements
  ADD CONSTRAINT advance_settlements_one_obligation
  CHECK (bill_id IS NULL OR levy_assessment_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS advance_settlements_one_per_payment_levy
  ON public.advance_settlements (advance_id, levy_assessment_id)
  WHERE advance_kind = 'PAYMENT'
    AND levy_assessment_id IS NOT NULL
    AND is_voided = false;

CREATE INDEX IF NOT EXISTS idx_advance_settlements_levy
  ON public.advance_settlements (levy_assessment_id)
  WHERE levy_assessment_id IS NOT NULL AND is_voided = false;

CREATE INDEX IF NOT EXISTS idx_levy_assessments_payable_fifo
  ON public.levy_assessments (society_id, unit_id, created_at, id)
  WHERE is_voided = false AND status = 'PENDING';

COMMENT ON COLUMN public.advance_settlements.levy_assessment_id IS
  'The levy obligation paid by this allocation. Mutually exclusive with bill_id.';
COMMENT ON COLUMN public.payments.auto_apply_credit IS
  'Whether unapplied_amount is undirected flat-account credit that automatically pays the oldest payable bill or levy assessment.';

-- Residents may inspect the allocation trail of their own receipts. The
-- operator policy remains unchanged; this is SELECT-only and follows the
-- payment back to the membership-scoped unit.
DROP POLICY IF EXISTS advance_settlements_resident_own_payment
  ON public.advance_settlements;
CREATE POLICY advance_settlements_resident_own_payment
  ON public.advance_settlements FOR SELECT TO authenticated
  USING (
    advance_kind = 'PAYMENT'
    AND EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.id = advance_id
        AND p.society_id = advance_settlements.society_id
        AND p.unit_id = private.auth_membership_unit(advance_settlements.society_id)
    )
  );

-- One unit-level transaction lock serialises bill issuance, levy raising and
-- receipt approval. Obligations are ordered by the date they became payable;
-- UUID is a stable final tie-breaker. Each target is row-locked immediately
-- before mutation, while receipt credit is consumed oldest-receipt-first.
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
  v_obligation record;
  v_bill public.bills%ROWTYPE;
  v_levy public.levy_assessments%ROWTYPE;
  v_payment record;
  v_outstanding numeric;
  v_apply numeric;
  v_total_applied numeric := 0;
  v_credit_found boolean;
  v_label text;
BEGIN
  IF p_society_id IS NULL OR p_unit_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_unit_id::text, 0));

  FOR v_obligation IN
    SELECT obligation_kind, obligation_id, obligation_date
    FROM (
      SELECT
        'BILL'::text AS obligation_kind,
        b.id AS obligation_id,
        COALESCE(b.due_date, make_date(b.bill_period_year, b.bill_period_month, 1)) AS obligation_date
      FROM public.bills b
      WHERE b.society_id = p_society_id
        AND b.unit_id = p_unit_id
        AND b.is_voided = false
        AND b.status IN ('ISSUED', 'OVERDUE')
        AND b.payable_amount - b.amount_settled > 0.005

      UNION ALL

      SELECT
        'LEVY'::text,
        a.id,
        a.created_at::date
      FROM public.levy_assessments a
      WHERE a.society_id = p_society_id
        AND a.unit_id = p_unit_id
        AND a.is_voided = false
        AND a.status = 'PENDING'
        AND a.amount - a.amount_settled > 0.005
    ) obligations
    ORDER BY obligation_date, obligation_kind, obligation_id
  LOOP
    IF v_obligation.obligation_kind = 'BILL' THEN
      SELECT * INTO v_bill
      FROM public.bills b
      WHERE b.id = v_obligation.obligation_id
        AND b.society_id = p_society_id
        AND b.unit_id = p_unit_id
        AND b.is_voided = false
        AND b.status IN ('ISSUED', 'OVERDUE')
      FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      v_outstanding := GREATEST(0, v_bill.payable_amount - v_bill.amount_settled);
      v_label := to_char(make_date(v_bill.bill_period_year, v_bill.bill_period_month, 1), 'Mon YYYY') || ' maintenance bill';
    ELSE
      SELECT * INTO v_levy
      FROM public.levy_assessments a
      WHERE a.id = v_obligation.obligation_id
        AND a.society_id = p_society_id
        AND a.unit_id = p_unit_id
        AND a.is_voided = false
        AND a.status = 'PENDING'
      FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      v_outstanding := GREATEST(0, v_levy.amount - v_levy.amount_settled);
      v_label := v_levy.levy_label || ' levy';
    END IF;

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

      IF NOT FOUND THEN EXIT; END IF;
      v_credit_found := true;
      v_apply := LEAST(v_outstanding, v_payment.unapplied_amount);

      UPDATE public.payments p
      SET unapplied_amount = GREATEST(0, p.unapplied_amount - v_apply),
          bill_ids = CASE
            WHEN v_obligation.obligation_kind <> 'BILL'
              OR v_bill.id = ANY(COALESCE(p.bill_ids, '{}'::uuid[]))
              THEN p.bill_ids
            ELSE array_append(COALESCE(p.bill_ids, '{}'::uuid[]), v_bill.id)
          END
      WHERE p.id = v_payment.id;

      IF v_obligation.obligation_kind = 'BILL' THEN
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
          settled_against, settled_date, notes, bill_id, levy_assessment_id
        ) VALUES (
          p_society_id, 'PAYMENT', v_payment.id, v_apply,
          v_label, COALESCE(p_settled_date, current_date),
          'Automatically applied from resident account credit', v_bill.id, NULL
        );
      ELSE
        UPDATE public.levy_assessments a
        SET amount_settled = a.amount_settled + v_apply,
            status = CASE
              WHEN a.amount_settled + v_apply >= a.amount - 0.005 THEN 'PAID'
              ELSE 'PENDING'
            END
        WHERE a.id = v_levy.id;

        INSERT INTO public.advance_settlements (
          society_id, advance_kind, advance_id, settled_amount,
          settled_against, settled_date, notes, bill_id, levy_assessment_id
        ) VALUES (
          p_society_id, 'PAYMENT', v_payment.id, v_apply,
          v_label, COALESCE(p_settled_date, current_date),
          'Automatically applied from resident account credit', NULL, v_levy.id
        );
      END IF;

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

-- A newly raised levy, or a corrected increase to one, immediately draws from
-- the same bucket as a new bill. amount_settled is intentionally absent from
-- the trigger column list so the allocator's own update cannot recurse.
CREATE OR REPLACE FUNCTION private.apply_payment_credit_after_levy_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.is_voided = false AND NEW.status = 'PENDING' THEN
    IF TG_OP = 'INSERT'
       OR OLD.is_voided = true
       OR OLD.status <> 'PENDING'
       OR NEW.amount > OLD.amount + 0.005
    THEN
      PERFORM private.apply_unit_payment_credit(NEW.society_id, NEW.unit_id, current_date);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.apply_payment_credit_after_levy_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_apply_payment_credit_after_levy_change
  ON public.levy_assessments;
CREATE TRIGGER trg_apply_payment_credit_after_levy_change
  AFTER INSERT OR UPDATE OF status, amount, is_voided
  ON public.levy_assessments
  FOR EACH ROW EXECUTE FUNCTION private.apply_payment_credit_after_levy_change();

-- New gateway links are account payments. Existing bill-directed links remain
-- strict and keep their reconciliation behaviour for backward compatibility.
ALTER TABLE public.resident_payment_links
  ADD COLUMN IF NOT EXISTS auto_apply_credit boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.confirm_resident_payment(
  p_link_id uuid, p_razorpay_link_id text, p_razorpay_payment_id text,
  p_amount_subunits bigint, p_currency text, p_status text, p_method text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_link public.resident_payment_links%ROWTYPE;
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_link
  FROM public.resident_payment_links l
  WHERE l.id = p_link_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_LINK_NOT_FOUND'; END IF;
  IF v_link.status = 'paid' THEN RETURN v_link.payment_id; END IF;

  IF p_razorpay_link_id IS DISTINCT FROM v_link.razorpay_link_id
     OR p_currency IS DISTINCT FROM 'INR'
     OR p_status IS DISTINCT FROM 'captured'
     OR p_amount_subunits IS DISTINCT FROM round(v_link.amount * 100)::bigint
  THEN
    UPDATE public.resident_payment_links
    SET reconciliation_required = true,
        reconciliation_note = 'Webhook facts conflict with payment link'
    WHERE id = v_link.id;
    RETURN NULL;
  END IF;

  IF v_link.auto_apply_credit THEN
    INSERT INTO public.payments (
      unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
      months_covered, notes, gateway_payment_id, unapplied_amount, auto_apply_credit
    ) VALUES (
      v_link.unit_id, v_link.society_id, '{}'::uuid[], v_link.amount,
      (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'OTHER' END)::public.payment_mode,
      current_date, 0, 'Online flat-account payment via Razorpay',
      p_razorpay_payment_id, v_link.amount, true
    )
    ON CONFLICT (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL
    DO NOTHING RETURNING id INTO v_payment_id;

    IF v_payment_id IS NULL THEN
      SELECT p.id INTO v_payment_id
      FROM public.payments p
      WHERE p.gateway_payment_id = p_razorpay_payment_id
        AND p.society_id = v_link.society_id
        AND p.unit_id = v_link.unit_id;
    END IF;
    IF v_payment_id IS NULL THEN RAISE EXCEPTION 'GATEWAY_PAYMENT_CONFLICT'; END IF;
  ELSE
    BEGIN
      PERFORM public.assert_payable_bills(
        v_link.society_id, v_link.unit_id, v_link.bill_ids, v_link.amount
      );
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%BILL_NOT_PAYABLE%'
         OR SQLERRM LIKE '%PAYMENT_AMOUNT_MISMATCH%'
      THEN
        INSERT INTO public.payments (
          unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
          months_covered, notes, gateway_payment_id, unapplied_amount, auto_apply_credit
        ) VALUES (
          v_link.unit_id, v_link.society_id, '{}'::uuid[], v_link.amount,
          (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'OTHER' END)::public.payment_mode,
          current_date, 0, 'Online payment via Razorpay — reconciliation required',
          p_razorpay_payment_id, v_link.amount, false
        )
        ON CONFLICT (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL
        DO NOTHING RETURNING id INTO v_payment_id;
        IF v_payment_id IS NULL THEN
          SELECT p.id INTO v_payment_id
          FROM public.payments p
          WHERE p.gateway_payment_id = p_razorpay_payment_id
            AND p.society_id = v_link.society_id
            AND p.unit_id = v_link.unit_id;
        END IF;
        IF v_payment_id IS NULL THEN RAISE EXCEPTION 'GATEWAY_PAYMENT_CONFLICT'; END IF;
        UPDATE public.resident_payment_links
        SET reconciliation_required = true,
            reconciliation_note = 'Paid gateway link references bills no longer payable',
            razorpay_payment_id = p_razorpay_payment_id,
            payment_id = v_payment_id, paid_at = now(), status = 'paid'
        WHERE id = v_link.id;
        RETURN v_payment_id;
      END IF;
      RAISE;
    END;

    INSERT INTO public.payments (
      unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
      months_covered, notes, gateway_payment_id, unapplied_amount, auto_apply_credit
    ) VALUES (
      v_link.unit_id, v_link.society_id, v_link.bill_ids, v_link.amount,
      (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'OTHER' END)::public.payment_mode,
      current_date, cardinality(v_link.bill_ids), 'Online payment via Razorpay',
      p_razorpay_payment_id, 0, false
    )
    ON CONFLICT (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL
    DO NOTHING RETURNING id INTO v_payment_id;
    IF v_payment_id IS NULL THEN
      SELECT p.id INTO v_payment_id
      FROM public.payments p
      WHERE p.gateway_payment_id = p_razorpay_payment_id
        AND p.society_id = v_link.society_id
        AND p.unit_id = v_link.unit_id;
    END IF;
    IF v_payment_id IS NULL THEN RAISE EXCEPTION 'GATEWAY_PAYMENT_CONFLICT'; END IF;

    UPDATE public.bills
    SET status = 'PAID', amount_settled = payable_amount
    WHERE id = ANY(v_link.bill_ids)
      AND society_id = v_link.society_id
      AND unit_id = v_link.unit_id;
  END IF;

  UPDATE public.resident_payment_links
  SET status = 'paid', paid_at = now(),
      razorpay_payment_id = p_razorpay_payment_id,
      payment_id = v_payment_id
  WHERE id = v_link.id;
  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_resident_payment(uuid, text, text, bigint, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_resident_payment(uuid, text, text, bigint, text, text, text)
  TO service_role;

-- Voiding one allocation reverses whichever obligation it targeted before the
-- credit is returned. The payment trigger may immediately reapply that money;
-- that is intentional bucket behaviour and leaves a fresh audit row.
CREATE OR REPLACE FUNCTION public.void_advance_settlement(
  p_society_id uuid, p_settlement_id uuid, p_reason text
)
RETURNS public.advance_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_settlement public.advance_settlements%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_bill public.bills%ROWTYPE;
  v_levy public.levy_assessments%ROWTYPE;
BEGIN
  IF p_society_id IS NULL OR (SELECT auth.uid()) IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_reason IS NULL OR char_length(trim(p_reason)) NOT BETWEEN 3 AND 500
  THEN RAISE EXCEPTION 'INVALID_VOID_REASON'; END IF;

  SELECT * INTO v_settlement
  FROM public.advance_settlements s
  WHERE s.id = p_settlement_id
    AND s.society_id = p_society_id
    AND s.is_voided = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_ACTIVE'; END IF;

  UPDATE public.advance_settlements
  SET is_voided = true, void_reason = trim(p_reason), voided_at = now()
  WHERE id = v_settlement.id
  RETURNING * INTO v_settlement;

  IF v_settlement.advance_kind = 'PAYMENT' THEN
    SELECT * INTO v_payment
    FROM public.payments p
    WHERE p.id = v_settlement.advance_id AND p.society_id = p_society_id
    FOR UPDATE;

    IF v_settlement.bill_id IS NOT NULL THEN
      SELECT * INTO v_bill
      FROM public.bills b
      WHERE b.id = v_settlement.bill_id AND b.society_id = p_society_id
      FOR UPDATE;
      IF FOUND AND v_bill.is_voided = false THEN
        UPDATE public.bills b
        SET amount_settled = GREATEST(0, b.amount_settled - v_settlement.settled_amount),
            status = CASE
              WHEN GREATEST(0, b.amount_settled - v_settlement.settled_amount) >= b.payable_amount - 0.005
                THEN 'PAID'::public.bill_status
              WHEN b.due_date < current_date THEN 'OVERDUE'::public.bill_status
              ELSE 'ISSUED'::public.bill_status
            END
        WHERE b.id = v_bill.id;
      END IF;
    ELSIF v_settlement.levy_assessment_id IS NOT NULL THEN
      SELECT * INTO v_levy
      FROM public.levy_assessments a
      WHERE a.id = v_settlement.levy_assessment_id
        AND a.society_id = p_society_id
      FOR UPDATE;
      IF FOUND AND v_levy.is_voided = false THEN
        UPDATE public.levy_assessments a
        SET amount_settled = GREATEST(0, a.amount_settled - v_settlement.settled_amount),
            status = CASE
              WHEN GREATEST(0, a.amount_settled - v_settlement.settled_amount) >= a.amount - 0.005
                THEN 'PAID' ELSE 'PENDING'
            END
        WHERE a.id = v_levy.id;
      END IF;
    END IF;

    IF FOUND AND v_payment.is_voided = false THEN
      UPDATE public.payments p
      SET unapplied_amount = LEAST(
        p.amount_paid,
        p.unapplied_amount + v_settlement.settled_amount
      )
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

-- Voiding the source receipt reverses all of its bill and levy allocations in
-- the same transaction. The payment is marked void first so restored balances
-- cannot be consumed again by its own trigger.
CREATE OR REPLACE FUNCTION public.void_payment_transactional(
  p_payment_id uuid, p_society_id uuid, p_actor_id uuid, p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_payment public.payments%ROWTYPE;
  v_auto record;
  v_auto_bill_ids uuid[] := '{}'::uuid[];
BEGIN
  SELECT * INTO v_payment
  FROM public.payments p
  WHERE p.id = p_payment_id AND p.society_id = p_society_id
  FOR UPDATE;
  IF NOT FOUND OR v_payment.is_voided THEN RAISE EXCEPTION 'PAYMENT_NOT_ACTIVE'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_payment.unit_id::text, 0));
  PERFORM 1
  FROM public.advance_settlements s
  WHERE s.society_id = p_society_id
    AND s.advance_kind = 'PAYMENT'
    AND s.advance_id = v_payment.id
    AND s.is_voided = false
  ORDER BY s.id
  FOR UPDATE;

  UPDATE public.payments
  SET is_voided = true, void_reason = p_reason,
      voided_by = p_actor_id::text, voided_at = now()
  WHERE id = v_payment.id;

  FOR v_auto IN
    SELECT s.bill_id, SUM(s.settled_amount) AS settled_amount
    FROM public.advance_settlements s
    WHERE s.society_id = p_society_id
      AND s.advance_kind = 'PAYMENT'
      AND s.advance_id = v_payment.id
      AND s.is_voided = false
      AND s.bill_id IS NOT NULL
    GROUP BY s.bill_id
  LOOP
    v_auto_bill_ids := array_append(v_auto_bill_ids, v_auto.bill_id);
    UPDATE public.bills b
    SET amount_settled = GREATEST(0, b.amount_settled - v_auto.settled_amount),
        status = CASE
          WHEN GREATEST(0, b.amount_settled - v_auto.settled_amount) >= b.payable_amount - 0.005
            THEN 'PAID'::public.bill_status
          WHEN b.due_date < current_date THEN 'OVERDUE'::public.bill_status
          ELSE 'ISSUED'::public.bill_status
        END
    WHERE b.id = v_auto.bill_id
      AND b.society_id = p_society_id
      AND b.is_voided = false;
  END LOOP;

  FOR v_auto IN
    SELECT s.levy_assessment_id, SUM(s.settled_amount) AS settled_amount
    FROM public.advance_settlements s
    WHERE s.society_id = p_society_id
      AND s.advance_kind = 'PAYMENT'
      AND s.advance_id = v_payment.id
      AND s.is_voided = false
      AND s.levy_assessment_id IS NOT NULL
    GROUP BY s.levy_assessment_id
  LOOP
    UPDATE public.levy_assessments a
    SET amount_settled = GREATEST(0, a.amount_settled - v_auto.settled_amount),
        status = CASE
          WHEN GREATEST(0, a.amount_settled - v_auto.settled_amount) >= a.amount - 0.005
            THEN 'PAID' ELSE 'PENDING'
        END
    WHERE a.id = v_auto.levy_assessment_id
      AND a.society_id = p_society_id
      AND a.is_voided = false;
  END LOOP;

  UPDATE public.advance_settlements
  SET is_voided = true,
      void_reason = 'Source payment voided: ' || COALESCE(NULLIF(trim(p_reason), ''), 'No reason supplied'),
      voided_at = now()
  WHERE society_id = p_society_id
    AND advance_kind = 'PAYMENT'
    AND advance_id = v_payment.id
    AND is_voided = false;

  -- Directed legacy payments predate the allocation journal. Preserve their
  -- established bill-rebuild path while excluding bills already reversed from
  -- this receipt's explicit settlement rows.
  IF cardinality(v_payment.bill_ids) > 0 THEN
    PERFORM 1
    FROM public.bills b
    WHERE b.id = ANY(v_payment.bill_ids)
      AND b.society_id = v_payment.society_id
      AND b.unit_id = v_payment.unit_id
    ORDER BY b.id
    FOR UPDATE;

    UPDATE public.bills b
    SET status = CASE
          WHEN b.due_date < current_date THEN 'OVERDUE'::public.bill_status
          ELSE 'ISSUED'::public.bill_status
        END,
        amount_settled = COALESCE((
          SELECT SUM(s.settled_amount)
          FROM public.advance_settlements s
          WHERE s.bill_id = b.id AND s.is_voided = false
        ), 0)
    WHERE b.id = ANY(v_payment.bill_ids)
      AND NOT (b.id = ANY(v_auto_bill_ids))
      AND b.society_id = v_payment.society_id
      AND b.unit_id = v_payment.unit_id
      AND b.is_voided = false
      AND NOT EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.id <> v_payment.id
          AND p.is_voided = false
          AND b.id = ANY(p.bill_ids)
      );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.void_payment_transactional(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_payment_transactional(uuid, uuid, uuid, text)
  TO service_role;


CREATE OR REPLACE FUNCTION public.update_levy_collection_transactional(
  p_society_id uuid, p_collection_id uuid, p_amount_paid numeric,
  p_payment_date date, p_payment_mode text, p_notes text, p_recorded_by text
)
RETURNS public.amc_collections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_collection public.amc_collections%ROWTYPE;
  v_assessment public.levy_assessments%ROWTYPE;
  v_delta numeric;
  v_new_settled numeric;
BEGIN
  IF p_society_id IS NULL OR (SELECT auth.uid()) IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_amount_paid IS NULL OR p_amount_paid <= 0 OR p_amount_paid > 50000
    OR (p_payment_mode IS NOT NULL AND p_payment_mode NOT IN ('UPI', 'MANUAL_COLLECTION', 'BANK_TRANSFER', 'OTHER'))
    OR char_length(COALESCE(p_notes, '')) > 300
  THEN RAISE EXCEPTION 'INVALID_LEVY_COLLECTION'; END IF;

  SELECT * INTO v_collection
  FROM public.amc_collections c
  WHERE c.id = p_collection_id
    AND c.society_id = p_society_id
    AND c.is_voided = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEVY_COLLECTION_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_collection.unit_id::text, 0));
  SELECT * INTO v_assessment
  FROM public.levy_assessments a
  WHERE a.society_id = p_society_id
    AND a.unit_id = v_collection.unit_id
    AND a.levy_label = v_collection.levy_label
    AND a.is_voided = false
  FOR UPDATE;

  IF FOUND THEN
    v_delta := p_amount_paid - v_collection.amount_paid;
    v_new_settled := v_assessment.amount_settled + v_delta;
    IF v_new_settled < -0.005 THEN RAISE EXCEPTION 'LEVY_BALANCE_CONFLICT'; END IF;
    IF v_new_settled > v_assessment.amount + 0.005 THEN
      RAISE EXCEPTION 'COLLECTION_EXCEEDS_ASSESSMENT';
    END IF;
    UPDATE public.levy_assessments a
    SET amount_settled = GREATEST(0, v_new_settled),
        status = CASE WHEN v_new_settled >= a.amount - 0.005 THEN 'PAID' ELSE 'PENDING' END
    WHERE a.id = v_assessment.id;
  END IF;

  UPDATE public.amc_collections c
  SET amount_paid = p_amount_paid,
      payment_date = p_payment_date,
      payment_mode = COALESCE(p_payment_mode, v_collection.payment_mode),
      notes = p_notes,
      recorded_by = COALESCE(p_recorded_by, v_collection.recorded_by)
  WHERE c.id = v_collection.id
  RETURNING * INTO v_collection;
  RETURN v_collection;
END;
$$;

REVOKE ALL ON FUNCTION public.update_levy_collection_transactional(uuid, uuid, numeric, date, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_levy_collection_transactional(uuid, uuid, numeric, date, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.void_levy_collection_transactional(
  p_society_id uuid, p_collection_id uuid, p_reason text
)
RETURNS public.amc_collections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_collection public.amc_collections%ROWTYPE;
  v_assessment public.levy_assessments%ROWTYPE;
BEGIN
  IF p_society_id IS NULL OR (SELECT auth.uid()) IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_reason IS NULL OR char_length(trim(p_reason)) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'INVALID_VOID_REASON'; END IF;

  SELECT * INTO v_collection
  FROM public.amc_collections c
  WHERE c.id = p_collection_id
    AND c.society_id = p_society_id
    AND c.is_voided = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEVY_COLLECTION_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_collection.unit_id::text, 0));
  SELECT * INTO v_assessment
  FROM public.levy_assessments a
  WHERE a.society_id = p_society_id
    AND a.unit_id = v_collection.unit_id
    AND a.levy_label = v_collection.levy_label
    AND a.is_voided = false
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.levy_assessments a
    SET amount_settled = GREATEST(0, a.amount_settled - v_collection.amount_paid),
        status = CASE
          WHEN GREATEST(0, a.amount_settled - v_collection.amount_paid) >= a.amount - 0.005
            THEN 'PAID' ELSE 'PENDING'
        END
    WHERE a.id = v_assessment.id;
  END IF;

  UPDATE public.amc_collections c
  SET is_voided = true, void_reason = trim(p_reason), voided_at = now()
  WHERE c.id = v_collection.id
  RETURNING * INTO v_collection;
  RETURN v_collection;
END;
$$;

REVOKE ALL ON FUNCTION public.void_levy_collection_transactional(uuid, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.void_levy_collection_transactional(uuid, uuid, text)
  TO authenticated;

-- Rebalance migration 072's automatic bill-only draws so an older levy is not
-- skipped merely because the maintenance allocator ran one migration earlier.
DO $$
DECLARE
  v_unit record;
  v_settlement record;
BEGIN
  FOR v_unit IN
    SELECT DISTINCT s.society_id, p.unit_id
    FROM public.advance_settlements s
    JOIN public.payments p ON p.id = s.advance_id
    WHERE s.advance_kind = 'PAYMENT'
      AND s.is_voided = false
      AND s.notes = 'Automatically applied from resident account credit'
      AND p.auto_apply_credit = true
    ORDER BY s.society_id, p.unit_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_unit.unit_id::text, 0));

    -- Prevent the payment-increase trigger from reallocating halfway through
    -- the reversal. The trigger does not watch auto_apply_credit itself.
    UPDATE public.payments p
    SET auto_apply_credit = false
    WHERE p.society_id = v_unit.society_id
      AND p.unit_id = v_unit.unit_id
      AND p.id IN (
        SELECT s.advance_id
        FROM public.advance_settlements s
        WHERE s.society_id = v_unit.society_id
          AND s.advance_kind = 'PAYMENT'
          AND s.is_voided = false
          AND s.notes = 'Automatically applied from resident account credit'
      );

    FOR v_settlement IN
      SELECT s.*
      FROM public.advance_settlements s
      JOIN public.payments p ON p.id = s.advance_id
      WHERE s.society_id = v_unit.society_id
        AND p.unit_id = v_unit.unit_id
        AND s.advance_kind = 'PAYMENT'
        AND s.is_voided = false
        AND s.notes = 'Automatically applied from resident account credit'
      ORDER BY s.id
      FOR UPDATE OF s
    LOOP
      IF v_settlement.bill_id IS NOT NULL THEN
        UPDATE public.bills b
        SET amount_settled = GREATEST(0, b.amount_settled - v_settlement.settled_amount),
            status = CASE
              WHEN GREATEST(0, b.amount_settled - v_settlement.settled_amount) >= b.payable_amount - 0.005
                THEN 'PAID'::public.bill_status
              WHEN b.due_date < current_date THEN 'OVERDUE'::public.bill_status
              ELSE 'ISSUED'::public.bill_status
            END
        WHERE b.id = v_settlement.bill_id AND b.is_voided = false;
      END IF;
      UPDATE public.payments p
      SET unapplied_amount = LEAST(p.amount_paid, p.unapplied_amount + v_settlement.settled_amount)
      WHERE p.id = v_settlement.advance_id AND p.is_voided = false;
      UPDATE public.advance_settlements s
      SET is_voided = true,
          void_reason = 'Rebalanced into flat-wide account allocation',
          voided_at = now()
      WHERE s.id = v_settlement.id;
    END LOOP;

    UPDATE public.payments p
    SET auto_apply_credit = true
    WHERE p.society_id = v_unit.society_id
      AND p.unit_id = v_unit.unit_id
      AND p.is_voided = false
      AND p.unapplied_amount > 0.005
      AND p.auto_apply_credit = false
      AND COALESCE(p.notes, '') NOT ILIKE '%reconciliation required%';

    PERFORM private.apply_unit_payment_credit(v_unit.society_id, v_unit.unit_id, current_date);
  END LOOP;

  -- Units with untouched credit and only levies also need a first allocation.
  FOR v_unit IN
    SELECT DISTINCT p.society_id, p.unit_id
    FROM public.payments p
    WHERE p.is_voided = false
      AND p.auto_apply_credit = true
      AND p.unapplied_amount > 0.005
    ORDER BY p.society_id, p.unit_id
  LOOP
    PERFORM private.apply_unit_payment_credit(v_unit.society_id, v_unit.unit_id, current_date);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
