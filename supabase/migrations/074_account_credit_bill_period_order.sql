-- Account credit bill period order.

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
  IF p_society_id IS NULL OR p_unit_id IS NULL THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_unit_id::text, 0));

  FOR v_obligation IN
    SELECT obligation_kind, obligation_id, obligation_date
    FROM (
      SELECT
        'BILL'::text AS obligation_kind,
        b.id AS obligation_id,
        make_date(b.bill_period_year, b.bill_period_month, 1) AS obligation_date
      FROM public.bills b
      WHERE b.society_id = p_society_id
        AND b.unit_id = p_unit_id
        AND b.is_voided = false
        AND b.status IN ('ISSUED', 'OVERDUE')
        AND b.payable_amount - b.amount_settled > 0.005

      UNION ALL

      SELECT 'LEVY'::text, a.id, a.created_at::date
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
      SELECT p.id, p.unapplied_amount INTO v_payment
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
          p_society_id, 'PAYMENT', v_payment.id, v_apply, v_label,
          COALESCE(p_settled_date, current_date),
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
          p_society_id, 'PAYMENT', v_payment.id, v_apply, v_label,
          COALESCE(p_settled_date, current_date),
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

NOTIFY pgrst, 'reload schema';
