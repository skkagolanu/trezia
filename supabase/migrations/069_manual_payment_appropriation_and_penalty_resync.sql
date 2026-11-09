-- Manual payment appropriation and penalty resync.
CREATE OR REPLACE FUNCTION private.automatic_penalty(
  p_base_amount numeric, p_rate_percent numeric
)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT round(COALESCE(p_base_amount, 0) * GREATEST(COALESCE(p_rate_percent, 0), 0) / 100, 2);
$$;

-- ---------------------------------------------------------------------------
-- 2. Bills keep amount_settled consistent with a PAID status
-- ---------------------------------------------------------------------------

-- Several settlement paths predate migration 066 and still write status='PAID'
-- without touching amount_settled: confirm_resident_payment (058/061) and the
-- allocated branch of commit_society_import (063). Nothing below reads such a
-- row — every calculation that nets amount_settled off also restricts itself to
-- ISSUED/OVERDUE bills, so a PAID bill contributes zero either way — but the
-- rows are still wrong on their face, and a future reader of the column should
-- not have to know which writer produced them.
--
-- A repair statement, deliberately not a trigger: payable_amount is a STORED
-- generated column, and a BEFORE trigger cannot read it (Postgres computes
-- generated columns after BEFORE triggers run), so the obvious enforcement
-- point silently compares against NULL. Same statement migration 066 ran; it is
-- idempotent and only ever raises amount_settled to the value a PAID bill is
-- defined to have.
UPDATE public.bills SET amount_settled = payable_amount
  WHERE status = 'PAID' AND amount_settled < payable_amount;


CREATE OR REPLACE FUNCTION public.assert_payable_bills(
  p_society_id uuid, p_unit_id uuid, p_bill_ids uuid[], p_amount numeric
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_count integer; v_total numeric;
BEGIN
  IF p_bill_ids IS NULL OR cardinality(p_bill_ids) = 0
     OR cardinality(p_bill_ids) <> cardinality(ARRAY(SELECT DISTINCT x FROM unnest(p_bill_ids) AS x)) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_BILL_IDS';
  END IF;
  PERFORM 1 FROM public.bills b
    WHERE b.id = ANY(p_bill_ids) AND b.society_id = p_society_id AND b.unit_id = p_unit_id
    ORDER BY b.id FOR UPDATE;
  SELECT count(*), coalesce(sum(GREATEST(b.payable_amount - b.amount_settled, 0)), 0)
  INTO v_count, v_total
  FROM public.bills b
  WHERE b.id = ANY(p_bill_ids) AND b.society_id = p_society_id AND b.unit_id = p_unit_id
    AND b.is_voided = false AND b.status IN ('ISSUED', 'OVERDUE');
  IF v_count <> cardinality(p_bill_ids) THEN RAISE EXCEPTION 'BILL_NOT_PAYABLE'; END IF;
  -- Paise tolerance rather than exact equality: payable_amount is generated
  -- from rounded tax components, so an exact-match test rejected legitimate
  -- one-paise differences.
  IF p_amount IS NULL OR abs(p_amount - v_total) > 0.005 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. A manually recorded payment settles the months it was recorded against
-- ---------------------------------------------------------------------------

-- p_payload gains an optional "month_periods": [{"year":2025,"month":10}, …],
-- resolved by the API route from months_detail through
-- src/lib/utils/months.ts, so the month-label parsing stays in the tested pure
-- module and the bill locking stays in here.
CREATE OR REPLACE FUNCTION public.record_manual_payment(
  p_society_id uuid, p_actor_id uuid, p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_payment_id uuid; v_unit_id uuid; v_resident_id uuid; v_bill_ids uuid[]; v_amount numeric;
  v_mode text; v_date date; v_time time; v_utr text; v_collector text; v_recorded_by text;
  v_months integer; v_detail text; v_notes text;
  v_period_keys integer[]; v_directed boolean; v_bill record; v_remaining numeric;
  v_outstanding numeric; v_apply numeric; v_applied_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT (p_payload->>'unit_id')::uuid, nullif(p_payload->>'resident_id','')::uuid,
    CASE WHEN jsonb_typeof(p_payload->'bill_ids') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'bill_ids')::uuid) ELSE '{}'::uuid[] END,
    coalesce((p_payload->>'amount_paid')::numeric,(p_payload->>'amount')::numeric), p_payload->>'payment_mode', (p_payload->>'payment_date')::date,
    nullif(p_payload->>'payment_time','')::time, nullif(p_payload->>'utr_reference',''), nullif(p_payload->>'collector_name',''), nullif(p_payload->>'recorded_by',''),
    coalesce((p_payload->>'months_covered')::integer,1), nullif(p_payload->>'months_detail',''), nullif(p_payload->>'notes','')
    INTO v_unit_id,v_resident_id,v_bill_ids,v_amount,v_mode,v_date,v_time,v_utr,v_collector,v_recorded_by,v_months,v_detail,v_notes;

  IF NOT EXISTS (SELECT 1 FROM public.units u WHERE u.id=v_unit_id AND u.society_id=p_society_id)
     OR (v_resident_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.residents r WHERE r.id=v_resident_id AND r.unit_id=v_unit_id)) THEN
    RAISE EXCEPTION 'PAYMENT_TENANT_MISMATCH';
  END IF;

  -- Serialise concurrent recording for this flat, so two treasurers recording
  -- at once cannot both appropriate the same outstanding balance.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_unit_id::text, 0));

  IF cardinality(v_bill_ids) > 0 THEN
    -- Bills named explicitly: unchanged exact-total contract, settled in full
    -- below once the payment row exists.
    PERFORM public.assert_payable_bills(p_society_id, v_unit_id, v_bill_ids, v_amount);
    v_applied_ids := v_bill_ids;
    v_remaining := 0;
  ELSE
    -- The selected months are flattened once, here, into a sorted array of
    -- year*12+month keys. Testing each candidate bill against
    -- jsonb_array_elements() instead would re-expand the document for every row
    -- the scan considers; an integer = ANY(array) is a single comparison
    -- against an already-materialised list.
    SELECT COALESCE(array_agg(DISTINCT (elem->>'year')::int * 12 + (elem->>'month')::int), '{}'::integer[])
    INTO v_period_keys
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_payload->'month_periods') = 'array'
           THEN p_payload->'month_periods' ELSE '[]'::jsonb END
    ) AS elem;
    -- Contract Act s.59 when the treasurer named months, s.61 (oldest first)
    -- when they did not. Selecting months that have no bill is not an error:
    -- the receipt simply stays unapplied and surfaces on /advances.
    v_directed := cardinality(v_period_keys) > 0;
    v_remaining := v_amount;

    -- A bill is settled in FULL by this payment or not touched at all, and the
    -- shortfall is held as unapplied. That is not a UX preference, it is what
    -- keeps a void exactly reversible: void_payment_transactional reverts a
    -- bill only when no OTHER live payment names it, and it has no per-bill
    -- split to subtract, so two payments part-crediting one bill would make the
    -- first void either over- or under-refund. The system already holds this
    -- invariant elsewhere — advance_settlements_one_per_bill (066) caps a bill
    -- at one live settlement for the same reason. A short payment therefore
    -- lands on /advances, where create_advance_settlement part-settles it under
    -- its own lock, against a named bill, with an audit trail.

    FOR v_bill IN
      SELECT b.id, b.payable_amount, b.amount_settled
      FROM public.bills b
      WHERE b.society_id = p_society_id
        AND b.unit_id = v_unit_id
        AND b.is_voided = false
        AND b.status IN ('ISSUED', 'OVERDUE')
        AND (
          NOT v_directed
          OR (b.bill_period_year * 12 + b.bill_period_month) = ANY(v_period_keys)
        )
      ORDER BY b.bill_period_year, b.bill_period_month, b.id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0.005;
      v_outstanding := GREATEST(0, v_bill.payable_amount - v_bill.amount_settled);
      CONTINUE WHEN v_outstanding <= 0.005;
      -- Not enough left for this month: skip it and keep looking, because a
      -- later month may be cheaper than an earlier one.
      CONTINUE WHEN v_outstanding > v_remaining + 0.005;

      v_apply := v_outstanding;
      UPDATE public.bills
        SET amount_settled = payable_amount,
            status = 'PAID'
        WHERE id = v_bill.id;

      v_applied_ids := array_append(v_applied_ids, v_bill.id);
      v_remaining := v_remaining - v_apply;
    END LOOP;
  END IF;

  -- The payment keeps its real method; only unapplied_amount says how much of
  -- it is not yet allocated (migration 066). bill_ids records what it actually
  -- settled, which is also what void_payment_transactional needs to reverse.
  INSERT INTO public.payments(unit_id,society_id,resident_id,bill_ids,amount_paid,payment_mode,payment_date,payment_time,utr_reference,collector_name,recorded_by,months_covered,months_detail,notes,unapplied_amount)
  VALUES(v_unit_id,p_society_id,v_resident_id,v_applied_ids,v_amount,v_mode::public.payment_mode,v_date,v_time,v_utr,v_collector,v_recorded_by,v_months,v_detail,v_notes,GREATEST(0, v_remaining))
  RETURNING id INTO v_payment_id;

  IF cardinality(v_bill_ids) > 0 THEN
    UPDATE public.bills SET status='PAID', amount_settled = payable_amount
    WHERE id=ANY(v_bill_ids) AND society_id=p_society_id AND unit_id=v_unit_id AND is_voided=false;
  END IF;

  RETURN v_payment_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Voiding a payment gives the settled amount back
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.void_payment_transactional(p_payment_id uuid, p_society_id uuid, p_actor_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_payment public.payments%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM public.payments p WHERE p.id=p_payment_id AND p.society_id=p_society_id FOR UPDATE;
  IF NOT FOUND OR v_payment.is_voided THEN RAISE EXCEPTION 'PAYMENT_NOT_ACTIVE'; END IF;
  UPDATE public.payments SET is_voided=true,void_reason=p_reason,voided_by=p_actor_id::text,voided_at=now() WHERE id=v_payment.id;
  IF cardinality(v_payment.bill_ids) > 0 THEN
    PERFORM 1 FROM public.bills b
    WHERE b.id=ANY(v_payment.bill_ids) AND b.society_id=v_payment.society_id AND b.unit_id=v_payment.unit_id FOR UPDATE;
    -- Status alone is no longer enough to undo a settlement: since migration
    -- 066 a bill also carries amount_settled, and leaving it behind would make
    -- a reverted bill read as fully paid in a dues view that nets it off.
    -- What survives the void is whatever OTHER ledgered credit still points at
    -- the bill — live advance settlements — and nothing else.
    UPDATE public.bills b SET
      status = CASE WHEN b.due_date < current_date THEN 'OVERDUE'::public.bill_status ELSE 'ISSUED'::public.bill_status END,
      amount_settled = COALESCE((
        SELECT sum(s.settled_amount) FROM public.advance_settlements s
        WHERE s.bill_id = b.id AND s.is_voided = false
      ), 0)
    WHERE b.id=ANY(v_payment.bill_ids) AND b.society_id=v_payment.society_id AND b.unit_id=v_payment.unit_id AND b.is_voided=false AND NOT EXISTS (
      SELECT 1 FROM public.payments p WHERE p.id<>v_payment.id AND p.is_voided=false AND b.id=ANY(p.bill_ids));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Dues are what is still owed
-- ---------------------------------------------------------------------------

-- Two changes from migration 040. Every amount is now
-- payable_amount - amount_settled, and a bill only counts as an unpaid month
-- while something is still outstanding on it. The primary resident is picked
-- through a LATERAL … LIMIT 1 rather than a LEFT JOIN, because a unit carrying
-- two rows flagged is_primary duplicated the whole unit here — and every report
-- that sums total_due over this view double-counted that flat's arrears. The
-- selection rule is otherwise unchanged (active primary only, oldest first),
-- so a unit with no primary resident still reports no name, phone or email.
CREATE OR REPLACE VIEW v_dues_summary WITH (security_invoker = true) AS
WITH bill_dues AS (
  SELECT
    unit_id,
    COUNT(*) FILTER (
      WHERE NOT is_voided
        AND payable_amount - amount_settled > 0.005
        AND (
          status = 'OVERDUE'
          OR (status = 'ISSUED' AND due_date < current_date)
        )
    ) AS unpaid_months,
    SUM(GREATEST(payable_amount - amount_settled, 0)) FILTER (
      WHERE NOT is_voided
        AND (
          status = 'OVERDUE'
          OR (status = 'ISSUED' AND due_date < current_date)
        )
    ) AS total_due
  FROM bills
  GROUP BY unit_id
),
last_payment AS (
  SELECT unit_id, MAX(payment_date) AS last_paid_date
  FROM payments
  WHERE NOT is_voided
  GROUP BY unit_id
)
SELECT
  u.flat_number,
  r.full_name AS primary_resident,
  r.phone,
  r.email,
  COALESCE(bd.unpaid_months, 0) AS unpaid_months,
  COALESCE(bd.total_due, 0) AS total_due,
  lp.last_paid_date,
  u.society_id
FROM units u
LEFT JOIN LATERAL (
  SELECT res.full_name, res.phone, res.email
  FROM residents res
  WHERE res.unit_id = u.id AND res.is_primary = TRUE AND res.is_active = TRUE
  ORDER BY res.created_at, res.id
  LIMIT 1
) r ON TRUE
LEFT JOIN bill_dues bd ON bd.unit_id = u.id
LEFT JOIN last_payment lp ON lp.unit_id = u.id
WHERE u.is_active = TRUE
  AND NOT u.is_test_unit
ORDER BY u.flat_number;

-- Same correction for the redacted community view (migration 046).
CREATE OR REPLACE FUNCTION public.get_community_dues()
RETURNS TABLE(flat_number text, total_due numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.flat_number,
    COALESCE(SUM(
      CASE
        WHEN b.status = 'OVERDUE' THEN GREATEST(b.payable_amount - b.amount_settled, 0)
        WHEN b.status = 'ISSUED' AND b.due_date < CURRENT_DATE THEN GREATEST(b.payable_amount - b.amount_settled, 0)
        ELSE 0
      END
    ), 0)::numeric AS total_due
  FROM public.societies s
  JOIN public.units u
    ON u.society_id = s.id
   AND u.is_active = true
   AND u.is_test_unit = false
  LEFT JOIN public.bills b
    ON b.unit_id = u.id
   AND b.society_id = s.id
   AND b.is_voided = false
   AND b.status IN ('OVERDUE', 'ISSUED')
  WHERE s.slug = (NULLIF(current_setting('request.headers', true), '')::jsonb ->> 'x-society-slug')
    AND (
      private.auth_membership_role(s.id) IN ('admin', 'treasurer', 'resident')
      OR private.auth_platform_suspended_read(s.id)
    )
  GROUP BY u.id, u.flat_number
  ORDER BY u.flat_number;
$$;

REVOKE ALL ON FUNCTION public.get_community_dues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_dues() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Changing the penalty rate recomputes the penalties it produced
-- ---------------------------------------------------------------------------

-- Only unpaid, unvoided bills of real flats are touched: a PAID bill is a
-- closed financial record and is never rewritten, and a test flat is excluded
-- from every direct financial calculation.
--
-- The `penalty_amount = automatic_penalty(base_amount, old_rate)` predicate is
-- the whole safety of this: it recomputes exactly those penalties the old rate
-- itself produced, and leaves a penalty a treasurer entered by hand at bill
-- generation untouched. A bill that is not yet late goes to zero, because a
-- penalty before the due date is not something any rate should produce.
CREATE OR REPLACE FUNCTION private.resync_society_penalties(
  p_society_id uuid, p_old_rate numeric, p_new_rate numeric
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_updated integer;
BEGIN
  WITH resynced AS (
    UPDATE public.bills b SET
      penalty_amount = CASE
        WHEN b.status = 'OVERDUE' OR b.due_date < current_date
          THEN private.automatic_penalty(b.base_amount, p_new_rate)
        ELSE 0
      END,
      updated_at = now()
    FROM public.units u
    WHERE u.id = b.unit_id
      AND u.is_test_unit = false
      AND b.society_id = p_society_id
      AND b.is_voided = false
      AND b.status IN ('ISSUED', 'OVERDUE')
      AND b.penalty_amount = private.automatic_penalty(b.base_amount, p_old_rate)
      AND b.penalty_amount IS DISTINCT FROM CASE
        WHEN b.status = 'OVERDUE' OR b.due_date < current_date
          THEN private.automatic_penalty(b.base_amount, p_new_rate)
        ELSE 0
      END
    RETURNING b.id
  )
  SELECT count(*) INTO v_updated FROM resynced;

  -- Removing a penalty can take a part-settled bill's payable_amount down to
  -- (or below) what has already been paid against it. Leaving that bill ISSUED
  -- would keep chasing a flat that now owes nothing.
  UPDATE public.bills b SET status = 'PAID'
  WHERE b.society_id = p_society_id
    AND b.is_voided = false
    AND b.status IN ('ISSUED', 'OVERDUE')
    AND b.amount_settled > 0
    AND b.amount_settled >= b.payable_amount - 0.005;

  RETURN v_updated;
END;
$$;

-- A trigger, not a call inside update_financial_setup, because the rate has two
-- write paths: the migration-068 RPC used by the Treasurer's financial setup
-- form, and a direct society_config UPDATE from the Admin settings form. Only
-- the table sees both.
CREATE OR REPLACE FUNCTION public.on_penalty_rate_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_updated integer;
BEGIN
  IF COALESCE(NEW.penalty_rate_percent, 0) IS NOT DISTINCT FROM COALESCE(OLD.penalty_rate_percent, 0) THEN
    RETURN NEW;
  END IF;

  v_updated := private.resync_society_penalties(
    NEW.society_id, COALESCE(OLD.penalty_rate_percent, 0), COALESCE(NEW.penalty_rate_percent, 0)
  );

  INSERT INTO public.audit_log (
    action, table_name, record_id, old_data, new_data,
    performed_by, society_id, notes
  ) VALUES (
    'UPDATE', 'bills', NEW.society_id::text,
    jsonb_build_object('penalty_rate_percent', OLD.penalty_rate_percent),
    jsonb_build_object('penalty_rate_percent', NEW.penalty_rate_percent, 'bills_resynced', v_updated),
    COALESCE((SELECT auth.uid())::text, 'system'), NEW.society_id,
    'Penalty rate changed — automatic penalties recomputed on unpaid bills'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_society_config_penalty_rate ON public.society_config;
CREATE TRIGGER trg_society_config_penalty_rate
  AFTER UPDATE OF penalty_rate_percent ON public.society_config
  FOR EACH ROW EXECUTE FUNCTION public.on_penalty_rate_change();

-- Neither helper is ever called by a client: both run inside the SECURITY
-- DEFINER trigger, which executes as the function owner.
REVOKE ALL ON FUNCTION private.automatic_penalty(numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.resync_society_penalties(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_payable_bills(uuid,uuid,uuid[],numeric), public.record_manual_payment(uuid,uuid,jsonb), public.void_payment_transactional(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_payment(uuid,uuid,jsonb), public.void_payment_transactional(uuid,uuid,uuid,text) TO service_role;

NOTIFY pgrst, 'reload schema';
