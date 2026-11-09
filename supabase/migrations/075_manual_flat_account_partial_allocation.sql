-- Manual flat account partial allocation.

CREATE OR REPLACE FUNCTION public.record_manual_payment(
  p_society_id uuid, p_actor_id uuid, p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_payment_id uuid;
  v_unit_id uuid;
  v_resident_id uuid;
  v_bill_ids uuid[];
  v_amount numeric;
  v_mode text;
  v_date date;
  v_time time;
  v_utr text;
  v_collector text;
  v_recorded_by text;
  v_months integer;
  v_detail text;
  v_notes text;
  v_period_keys integer[];
  v_directed boolean;
  v_bill record;
  v_remaining numeric;
  v_outstanding numeric;
  v_apply numeric;
BEGIN
  SELECT
    (p_payload->>'unit_id')::uuid,
    nullif(p_payload->>'resident_id', '')::uuid,
    CASE
      WHEN jsonb_typeof(p_payload->'bill_ids') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'bill_ids')::uuid)
      ELSE '{}'::uuid[]
    END,
    coalesce((p_payload->>'amount_paid')::numeric, (p_payload->>'amount')::numeric),
    p_payload->>'payment_mode',
    (p_payload->>'payment_date')::date,
    nullif(p_payload->>'payment_time', '')::time,
    nullif(trim(p_payload->>'utr_reference'), ''),
    nullif(trim(p_payload->>'collector_name'), ''),
    nullif(trim(p_payload->>'recorded_by'), ''),
    coalesce((p_payload->>'months_covered')::integer, 1),
    nullif(trim(p_payload->>'months_detail'), ''),
    nullif(trim(p_payload->>'notes'), '')
  INTO
    v_unit_id, v_resident_id, v_bill_ids, v_amount, v_mode, v_date, v_time,
    v_utr, v_collector, v_recorded_by, v_months, v_detail, v_notes;

  IF p_society_id IS NULL OR p_actor_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.society_memberships m
      WHERE m.user_id = p_actor_id
        AND m.society_id = p_society_id
        AND m.status = 'active'
        AND m.role IN ('admin', 'treasurer')
    )
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  IF v_amount IS NULL OR v_amount <= 0 OR v_amount > 500000
    OR round(v_amount, 2) IS DISTINCT FROM v_amount
    OR v_mode NOT IN ('UPI', 'MANUAL_COLLECTION', 'BANK_TRANSFER', 'OTHER')
    OR v_date IS NULL OR v_date NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-31'
    OR v_months NOT BETWEEN 1 AND 24
    OR char_length(coalesce(v_utr, '')) > 100
    OR char_length(coalesce(v_collector, '')) > 100
    OR char_length(coalesce(v_recorded_by, '')) > 150
    OR char_length(coalesce(v_detail, '')) > 200
    OR char_length(coalesce(v_notes, '')) > 500
  THEN RAISE EXCEPTION 'INVALID_PAYMENT'; END IF;

  IF NOT EXISTS (
      SELECT 1 FROM public.units u
      WHERE u.id = v_unit_id AND u.society_id = p_society_id
    )
    OR (
      v_resident_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.id = v_resident_id
          AND r.unit_id = v_unit_id
          AND r.society_id = p_society_id
      )
    )
  THEN RAISE EXCEPTION 'PAYMENT_TENANT_MISMATCH'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_unit_id::text, 0));

  -- Preserve the strict bill-id contract for older service callers. Current
  -- Treasurer UI direction is expressed as month_periods below.
  IF cardinality(v_bill_ids) > 0 THEN
    PERFORM public.assert_payable_bills(
      p_society_id, v_unit_id, v_bill_ids, v_amount
    );
    INSERT INTO public.payments (
      unit_id, society_id, resident_id, bill_ids, amount_paid, payment_mode,
      payment_date, payment_time, utr_reference, collector_name, recorded_by,
      months_covered, months_detail, notes, unapplied_amount, auto_apply_credit
    ) VALUES (
      v_unit_id, p_society_id, v_resident_id, v_bill_ids, v_amount,
      v_mode::public.payment_mode, v_date, v_time, v_utr, v_collector,
      v_recorded_by, v_months, v_detail, v_notes, 0, false
    ) RETURNING id INTO v_payment_id;

    UPDATE public.bills b
    SET amount_settled = b.payable_amount,
        status = 'PAID'
    WHERE b.id = ANY(v_bill_ids)
      AND b.society_id = p_society_id
      AND b.unit_id = v_unit_id
      AND b.is_voided = false;
    RETURN v_payment_id;
  END IF;

  SELECT COALESCE(
    array_agg(DISTINCT (elem->>'year')::int * 12 + (elem->>'month')::int),
    '{}'::integer[]
  )
  INTO v_period_keys
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(p_payload->'month_periods') = 'array'
        THEN p_payload->'month_periods'
      ELSE '[]'::jsonb
    END
  ) AS elem;
  v_directed := cardinality(v_period_keys) > 0;


  IF NOT v_directed THEN
    INSERT INTO public.payments (
      unit_id, society_id, resident_id, bill_ids, amount_paid, payment_mode,
      payment_date, payment_time, utr_reference, collector_name, recorded_by,
      months_covered, months_detail, notes, unapplied_amount, auto_apply_credit
    ) VALUES (
      v_unit_id, p_society_id, v_resident_id, '{}'::uuid[], v_amount,
      v_mode::public.payment_mode, v_date, v_time, v_utr, v_collector,
      v_recorded_by, v_months, NULL, v_notes, v_amount, true
    ) RETURNING id INTO v_payment_id;
    RETURN v_payment_id;
  END IF;

  -- A Treasurer override names maintenance months. Keep the unused remainder
  -- out of the automatic bucket, but part-settle each selected bill in period
  -- order and record the exact reversible allocation.
  INSERT INTO public.payments (
    unit_id, society_id, resident_id, bill_ids, amount_paid, payment_mode,
    payment_date, payment_time, utr_reference, collector_name, recorded_by,
    months_covered, months_detail, notes, unapplied_amount, auto_apply_credit
  ) VALUES (
    v_unit_id, p_society_id, v_resident_id, '{}'::uuid[], v_amount,
    v_mode::public.payment_mode, v_date, v_time, v_utr, v_collector,
    v_recorded_by, v_months, v_detail, v_notes, v_amount, false
  ) RETURNING id INTO v_payment_id;

  v_remaining := v_amount;
  FOR v_bill IN
    SELECT b.*
    FROM public.bills b
    WHERE b.society_id = p_society_id
      AND b.unit_id = v_unit_id
      AND b.is_voided = false
      AND b.status IN ('ISSUED', 'OVERDUE')
      AND (b.bill_period_year * 12 + b.bill_period_month) = ANY(v_period_keys)
      AND b.payable_amount - b.amount_settled > 0.005
    ORDER BY b.bill_period_year, b.bill_period_month, b.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0.005;
    v_outstanding := GREATEST(0, v_bill.payable_amount - v_bill.amount_settled);
    v_apply := LEAST(v_outstanding, v_remaining);

    UPDATE public.bills b
    SET amount_settled = b.amount_settled + v_apply,
        status = CASE
          WHEN b.amount_settled + v_apply >= b.payable_amount - 0.005
            THEN 'PAID'::public.bill_status
          ELSE b.status
        END
    WHERE b.id = v_bill.id;

    UPDATE public.payments p
    SET unapplied_amount = GREATEST(0, p.unapplied_amount - v_apply),
        bill_ids = CASE
          WHEN v_bill.id = ANY(COALESCE(p.bill_ids, '{}'::uuid[])) THEN p.bill_ids
          ELSE array_append(COALESCE(p.bill_ids, '{}'::uuid[]), v_bill.id)
        END
    WHERE p.id = v_payment_id;

    INSERT INTO public.advance_settlements (
      society_id, advance_kind, advance_id, settled_amount,
      settled_against, settled_date, notes, bill_id, levy_assessment_id
    ) VALUES (
      p_society_id, 'PAYMENT', v_payment_id, v_apply,
      to_char(
        make_date(v_bill.bill_period_year, v_bill.bill_period_month, 1),
        'Mon YYYY'
      ) || ' maintenance bill',
      v_date, 'Treasurer-directed maintenance allocation', v_bill.id, NULL
    );
    v_remaining := v_remaining - v_apply;
  END LOOP;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_manual_payment(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_payment(uuid, uuid, jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';
