-- Financial trust and amc consolidation.

ALTER TABLE public.levy_configs
  ADD COLUMN IF NOT EXISTS is_active_for_new_collections boolean NOT NULL DEFAULT true;

-- Create the canonical AMC configuration before retiring a historical CMC
-- year label. Existing AMC values win; this never changes an amount already
-- assessed or a collection already recorded.
INSERT INTO public.levy_configs (society_id, levy_label, default_amount, is_active_for_new_collections)
SELECT
  lc.society_id,
  regexp_replace(lc.levy_label, '^CMC-', 'AMC-', 'i'),
  lc.default_amount,
  true
FROM public.levy_configs lc
WHERE lc.levy_label ~* '^CMC-(June-)?[0-9]{2,4}$'
ON CONFLICT (society_id, levy_label) DO NOTHING;

UPDATE public.levy_configs
SET is_active_for_new_collections = false
WHERE levy_label ~* '^CMC-(June-)?[0-9]{2,4}$';

ALTER TABLE public.levy_configs
  ADD COLUMN IF NOT EXISTS canonical_key text GENERATED ALWAYS AS (
    lower(regexp_replace(
      regexp_replace(btrim(levy_label), '^CMC-', 'AMC-', 'i'),
      '[[:space:]]+', ' ', 'g'
    ))
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS levy_configs_active_canonical_unique
  ON public.levy_configs (society_id, canonical_key)
  WHERE is_active_for_new_collections;

COMMENT ON COLUMN public.levy_configs.is_active_for_new_collections IS
  'Inactive historical labels remain readable/editable for audit, but cannot be selected for a new levy or collection.';
COMMENT ON COLUMN public.levy_configs.canonical_key IS
  'Case/spacing-normalized identity; historical CMC year labels share their AMC identity.';

-- ---------------------------------------------------------------------------
-- Whole-paise database boundary
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.resident_payment_claims
    WHERE amount IS DISTINCT FROM round(amount, 2)
  ) THEN
    RAISE EXCEPTION 'FRACTIONAL_PAISE_CLAIMS_REQUIRE_REVIEW';
  END IF;
END;
$$;

ALTER TABLE public.resident_payment_claims
  DROP CONSTRAINT IF EXISTS resident_payment_claims_whole_paise;
ALTER TABLE public.resident_payment_claims
  ADD CONSTRAINT resident_payment_claims_whole_paise
  CHECK (amount = round(amount, 2));

CREATE OR REPLACE FUNCTION private.assert_whole_paise(p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'INVALID_PAISE_AMOUNT';
  END IF;
  RETURN p_amount;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_whole_paise(numeric)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Penalty recalculation with source-backed credit restoration
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.resync_society_penalties(
  p_society_id uuid, p_old_rate numeric, p_new_rate numeric
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_candidate record;
  v_bill public.bills%ROWTYPE;
  v_allocation record;
  v_payment public.payments%ROWTYPE;
  v_old_settled numeric;
  v_new_penalty numeric;
  v_excess numeric;
  v_release numeric;
  v_available numeric;
  v_updated integer := 0;
  v_released_payment_ids uuid[];
BEGIN
  FOR v_candidate IN
    SELECT b.id, b.unit_id
    FROM public.bills b
    JOIN public.units u ON u.id = b.unit_id AND u.society_id = b.society_id
    WHERE b.society_id = p_society_id
      AND b.is_voided = false
      AND u.is_test_unit = false
      AND b.penalty_amount = private.automatic_penalty(b.base_amount, p_old_rate)
      AND (
        b.status IN ('ISSUED', 'OVERDUE')
        OR (
          b.status = 'PAID'
          AND private.automatic_penalty(b.base_amount, p_new_rate)
              < private.automatic_penalty(b.base_amount, p_old_rate)
        )
      )
    ORDER BY b.unit_id, b.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_candidate.unit_id::text, 0));

    SELECT * INTO v_bill
    FROM public.bills b
    WHERE b.id = v_candidate.id
      AND b.society_id = p_society_id
      AND b.unit_id = v_candidate.unit_id
      AND b.is_voided = false
    FOR UPDATE;
    IF NOT FOUND
      OR v_bill.penalty_amount <> private.automatic_penalty(v_bill.base_amount, p_old_rate)
    THEN
      CONTINUE;
    END IF;

    v_old_settled := v_bill.amount_settled;
    v_new_penalty := CASE
      WHEN v_bill.status = 'OVERDUE' OR v_bill.due_date < current_date OR v_bill.status = 'PAID'
        THEN private.automatic_penalty(v_bill.base_amount, p_new_rate)
      ELSE 0
    END;

    UPDATE public.bills b
    SET penalty_amount = v_new_penalty,
        updated_at = now()
    WHERE b.id = v_bill.id
    RETURNING * INTO v_bill;

    v_excess := GREATEST(0, round(v_old_settled - v_bill.payable_amount, 2));
    v_released_payment_ids := '{}'::uuid[];

    -- Release the newest journalled draws first. The receipt remains the cash
    -- source; only its allocation/credit split changes.
    FOR v_allocation IN
      SELECT s.id, s.advance_id, s.settled_amount
      FROM public.advance_settlements s
      WHERE s.society_id = p_society_id
        AND s.advance_kind = 'PAYMENT'
        AND s.bill_id = v_bill.id
        AND s.is_voided = false
      ORDER BY s.settled_date DESC, s.created_at DESC, s.id DESC
    LOOP
      EXIT WHEN v_excess = 0;

      SELECT * INTO v_payment
      FROM public.payments p
      WHERE p.id = v_allocation.advance_id
        AND p.society_id = p_society_id
        AND p.unit_id = v_bill.unit_id
        AND p.is_voided = false
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'PENALTY_CREDIT_SOURCE_MISSING'; END IF;

      PERFORM 1
      FROM public.advance_settlements s
      WHERE s.id = v_allocation.id AND s.is_voided = false
      FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;

      v_release := LEAST(v_excess, v_allocation.settled_amount);
      IF v_release = v_allocation.settled_amount THEN
        UPDATE public.advance_settlements
        SET is_voided = true,
            void_reason = 'Automatic penalty reduced; allocation returned to flat-account credit',
            voided_at = now()
        WHERE id = v_allocation.id;
      ELSE
        UPDATE public.advance_settlements
        SET settled_amount = settled_amount - v_release,
            notes = concat_ws(' · ', NULLIF(notes, ''), 'Automatic penalty reduction returned part to account credit')
        WHERE id = v_allocation.id;
      END IF;

      IF v_payment.unapplied_amount + v_release > v_payment.amount_paid THEN
        RAISE EXCEPTION 'PAYMENT_CREDIT_CONSERVATION_FAILED';
      END IF;
      UPDATE public.payments
      SET unapplied_amount = unapplied_amount + v_release,
          auto_apply_credit = false
      WHERE id = v_payment.id;
      UPDATE public.bills
      SET amount_settled = amount_settled - v_release
      WHERE id = v_bill.id;

      v_released_payment_ids := array_append(v_released_payment_ids, v_payment.id);
      v_excess := round(v_excess - v_release, 2);
    END LOOP;

    -- Pre-journal directed receipts can be sourced safely only when the receipt
    -- names this one bill and has an unjournalled allocated remainder.
    FOR v_payment IN
      SELECT p.*
      FROM public.payments p
      WHERE v_excess > 0
        AND p.society_id = p_society_id
        AND p.unit_id = v_bill.unit_id
        AND p.is_voided = false
        AND cardinality(COALESCE(p.bill_ids, '{}'::uuid[])) = 1
        AND v_bill.id = ANY(p.bill_ids)
      ORDER BY p.payment_date DESC, p.created_at DESC, p.id DESC
      FOR UPDATE
    LOOP
      SELECT GREATEST(0, round(
        v_payment.amount_paid - v_payment.unapplied_amount - COALESCE(SUM(s.settled_amount), 0), 2
      )) INTO v_available
      FROM public.advance_settlements s
      WHERE s.advance_kind = 'PAYMENT'
        AND s.advance_id = v_payment.id
        AND s.is_voided = false;

      v_release := LEAST(v_excess, v_available);
      IF v_release <= 0 THEN CONTINUE; END IF;
      UPDATE public.payments
      SET unapplied_amount = unapplied_amount + v_release,
          auto_apply_credit = false,
          bill_ids = CASE WHEN v_release = v_available THEN '{}'::uuid[] ELSE bill_ids END
      WHERE id = v_payment.id;
      UPDATE public.bills SET amount_settled = amount_settled - v_release WHERE id = v_bill.id;
      v_released_payment_ids := array_append(v_released_payment_ids, v_payment.id);
      v_excess := round(v_excess - v_release, 2);
      EXIT WHEN v_excess = 0;
    END LOOP;

    IF v_excess > 0 THEN
      RAISE EXCEPTION 'PENALTY_CREDIT_SOURCE_AMBIGUOUS bill=% excess=%', v_bill.id, v_excess;
    END IF;

    UPDATE public.bills b
    SET status = CASE

      WHEN v_bill.status = 'PAID' AND v_old_settled <= b.payable_amount
        THEN 'PAID'::public.bill_status
      WHEN b.amount_settled >= b.payable_amount THEN 'PAID'::public.bill_status
      WHEN b.due_date < current_date THEN 'OVERDUE'::public.bill_status
      ELSE 'ISSUED'::public.bill_status
    END
    WHERE b.id = v_bill.id;

    IF cardinality(v_released_payment_ids) > 0 THEN
      UPDATE public.payments
      SET auto_apply_credit = true
      WHERE id = ANY(v_released_payment_ids);
      PERFORM private.apply_unit_payment_credit(p_society_id, v_bill.unit_id, current_date);
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION private.resync_society_penalties(uuid, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Unit lock first for levy collection edits and voids
-- ---------------------------------------------------------------------------

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
  v_unit_id uuid;
  v_collection public.amc_collections%ROWTYPE;
  v_assessment public.levy_assessments%ROWTYPE;
  v_delta numeric;
  v_new_settled numeric;
BEGIN
  IF p_society_id IS NULL OR (SELECT auth.uid()) IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  PERFORM private.assert_whole_paise(p_amount_paid);
  IF p_amount_paid > 50000
    OR (p_payment_mode IS NOT NULL AND p_payment_mode NOT IN ('UPI', 'MANUAL_COLLECTION', 'BANK_TRANSFER', 'OTHER'))
    OR char_length(COALESCE(p_notes, '')) > 300
  THEN RAISE EXCEPTION 'INVALID_LEVY_COLLECTION'; END IF;

  SELECT c.unit_id INTO v_unit_id
  FROM public.amc_collections c
  WHERE c.id = p_collection_id
    AND c.society_id = p_society_id
    AND c.is_voided = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEVY_COLLECTION_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_unit_id::text, 0));

  SELECT * INTO v_assessment
  FROM public.levy_assessments a
  WHERE a.society_id = p_society_id
    AND a.unit_id = v_unit_id
    AND a.levy_label = (
      SELECT c.levy_label FROM public.amc_collections c
      WHERE c.id = p_collection_id AND c.society_id = p_society_id
    )
    AND a.is_voided = false
  FOR UPDATE;

  SELECT * INTO v_collection
  FROM public.amc_collections c
  WHERE c.id = p_collection_id
    AND c.society_id = p_society_id
    AND c.unit_id = v_unit_id
    AND c.is_voided = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEVY_COLLECTION_NOT_FOUND'; END IF;

  IF v_assessment.id IS NOT NULL THEN
    v_delta := p_amount_paid - v_collection.amount_paid;
    v_new_settled := v_assessment.amount_settled + v_delta;
    IF v_new_settled < 0 THEN RAISE EXCEPTION 'LEVY_BALANCE_CONFLICT'; END IF;
    IF v_new_settled > v_assessment.amount THEN
      RAISE EXCEPTION 'COLLECTION_EXCEEDS_ASSESSMENT';
    END IF;
    UPDATE public.levy_assessments a
    SET amount_settled = v_new_settled,
        status = CASE WHEN v_new_settled >= a.amount THEN 'PAID' ELSE 'PENDING' END
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
  v_unit_id uuid;
  v_label text;
  v_collection public.amc_collections%ROWTYPE;
  v_assessment public.levy_assessments%ROWTYPE;
BEGIN
  IF p_society_id IS NULL OR (SELECT auth.uid()) IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_reason IS NULL OR char_length(trim(p_reason)) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'INVALID_VOID_REASON'; END IF;

  SELECT c.unit_id, c.levy_label INTO v_unit_id, v_label
  FROM public.amc_collections c
  WHERE c.id = p_collection_id
    AND c.society_id = p_society_id
    AND c.is_voided = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEVY_COLLECTION_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_unit_id::text, 0));

  SELECT * INTO v_assessment
  FROM public.levy_assessments a
  WHERE a.society_id = p_society_id
    AND a.unit_id = v_unit_id
    AND a.levy_label = v_label
    AND a.is_voided = false
  FOR UPDATE;

  SELECT * INTO v_collection
  FROM public.amc_collections c
  WHERE c.id = p_collection_id
    AND c.society_id = p_society_id
    AND c.unit_id = v_unit_id
    AND c.is_voided = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEVY_COLLECTION_NOT_FOUND'; END IF;

  IF v_assessment.id IS NOT NULL THEN
    UPDATE public.levy_assessments a
    SET amount_settled = GREATEST(0, a.amount_settled - v_collection.amount_paid),
        status = CASE
          WHEN GREATEST(0, a.amount_settled - v_collection.amount_paid) >= a.amount
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

REVOKE ALL ON FUNCTION public.update_levy_collection_transactional(uuid, uuid, numeric, date, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_levy_collection_transactional(uuid, uuid, numeric, date, text, text, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.void_levy_collection_transactional(uuid, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.void_levy_collection_transactional(uuid, uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Unit -> obligations -> payment -> settlements for receipt voiding
-- ---------------------------------------------------------------------------

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
  v_unit_id uuid;
  v_payment public.payments%ROWTYPE;
  v_auto record;
  v_auto_bill_ids uuid[] := '{}'::uuid[];
BEGIN
  SELECT p.unit_id INTO v_unit_id
  FROM public.payments p
  WHERE p.id = p_payment_id AND p.society_id = p_society_id AND p.is_voided = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_ACTIVE'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_unit_id::text, 0));

  PERFORM 1
  FROM public.bills b
  WHERE b.society_id = p_society_id
    AND b.unit_id = v_unit_id
    AND (
      b.id = ANY(COALESCE((SELECT p.bill_ids FROM public.payments p WHERE p.id = p_payment_id), '{}'::uuid[]))
      OR EXISTS (
        SELECT 1 FROM public.advance_settlements s
        WHERE s.advance_kind = 'PAYMENT' AND s.advance_id = p_payment_id
          AND s.bill_id = b.id AND s.is_voided = false
      )
    )
  ORDER BY b.id
  FOR UPDATE;

  PERFORM 1
  FROM public.levy_assessments a
  WHERE a.society_id = p_society_id
    AND a.unit_id = v_unit_id
    AND EXISTS (
      SELECT 1 FROM public.advance_settlements s
      WHERE s.advance_kind = 'PAYMENT' AND s.advance_id = p_payment_id
        AND s.levy_assessment_id = a.id AND s.is_voided = false
    )
  ORDER BY a.id
  FOR UPDATE;

  SELECT * INTO v_payment
  FROM public.payments p
  WHERE p.id = p_payment_id
    AND p.society_id = p_society_id
    AND p.unit_id = v_unit_id
    AND p.is_voided = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_ACTIVE'; END IF;

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
          WHEN GREATEST(0, b.amount_settled - v_auto.settled_amount) >= b.payable_amount
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
          WHEN GREATEST(0, a.amount_settled - v_auto.settled_amount) >= a.amount
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

  IF cardinality(v_payment.bill_ids) > 0 THEN
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

-- ---------------------------------------------------------------------------
-- Unit -> obligation -> payment -> settlement for one-allocation voiding
-- ---------------------------------------------------------------------------

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
  v_probe record;
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

  SELECT
    s.advance_kind, s.advance_id, s.bill_id, s.levy_assessment_id,
    COALESCE(p.unit_id, b.unit_id, a.unit_id) AS unit_id
  INTO v_probe
  FROM public.advance_settlements s
  LEFT JOIN public.payments p
    ON s.advance_kind = 'PAYMENT' AND p.id = s.advance_id AND p.society_id = s.society_id
  LEFT JOIN public.bills b ON b.id = s.bill_id AND b.society_id = s.society_id
  LEFT JOIN public.levy_assessments a ON a.id = s.levy_assessment_id AND a.society_id = s.society_id
  WHERE s.id = p_settlement_id
    AND s.society_id = p_society_id
    AND s.is_voided = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_ACTIVE'; END IF;

  IF v_probe.unit_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_probe.unit_id::text, 0));
  END IF;

  IF v_probe.bill_id IS NOT NULL THEN
    SELECT * INTO v_bill
    FROM public.bills b
    WHERE b.id = v_probe.bill_id AND b.society_id = p_society_id
    FOR UPDATE;
  ELSIF v_probe.levy_assessment_id IS NOT NULL THEN
    SELECT * INTO v_levy
    FROM public.levy_assessments a
    WHERE a.id = v_probe.levy_assessment_id AND a.society_id = p_society_id
    FOR UPDATE;
  END IF;

  IF v_probe.advance_kind = 'PAYMENT' THEN
    SELECT * INTO v_payment
    FROM public.payments p
    WHERE p.id = v_probe.advance_id
      AND p.society_id = p_society_id
      AND p.unit_id = v_probe.unit_id
    FOR UPDATE;
  END IF;

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

  IF v_settlement.bill_id IS NOT NULL AND v_bill.id IS NOT NULL AND v_bill.is_voided = false THEN
    UPDATE public.bills b
    SET amount_settled = GREATEST(0, b.amount_settled - v_settlement.settled_amount),
        status = CASE
          WHEN GREATEST(0, b.amount_settled - v_settlement.settled_amount) >= b.payable_amount
            THEN 'PAID'::public.bill_status
          WHEN b.due_date < current_date THEN 'OVERDUE'::public.bill_status
          ELSE 'ISSUED'::public.bill_status
        END
    WHERE b.id = v_bill.id;
  ELSIF v_settlement.levy_assessment_id IS NOT NULL
      AND v_levy.id IS NOT NULL AND v_levy.is_voided = false THEN
    UPDATE public.levy_assessments a
    SET amount_settled = GREATEST(0, a.amount_settled - v_settlement.settled_amount),
        status = CASE
          WHEN GREATEST(0, a.amount_settled - v_settlement.settled_amount) >= a.amount
            THEN 'PAID' ELSE 'PENDING'
        END
    WHERE a.id = v_levy.id;
  END IF;

  IF v_settlement.advance_kind = 'PAYMENT'
    AND v_payment.id IS NOT NULL AND v_payment.is_voided = false
  THEN
    IF v_payment.unapplied_amount + v_settlement.settled_amount > v_payment.amount_paid THEN
      RAISE EXCEPTION 'PAYMENT_CREDIT_CONSERVATION_FAILED';
    END IF;
    UPDATE public.payments p
    SET unapplied_amount = p.unapplied_amount + v_settlement.settled_amount,
        auto_apply_credit = true
    WHERE p.id = v_payment.id;
  END IF;

  RETURN v_settlement;
END;
$$;

REVOKE ALL ON FUNCTION public.void_advance_settlement(uuid, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.void_advance_settlement(uuid, uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.create_advance_settlement(
  p_society_id uuid, p_advance_kind text, p_advance_id uuid,
  p_settled_amount numeric, p_settled_against text, p_settled_date date,
  p_notes text DEFAULT NULL, p_bill_id uuid DEFAULT NULL
)
RETURNS public.advance_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
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
  PERFORM private.assert_whole_paise(p_settled_amount);
  IF p_advance_id IS NULL OR p_advance_kind NOT IN ('PAYMENT', 'EXPENSE')
    OR p_settled_amount > 500000
    OR p_settled_date IS NULL OR p_settled_date NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-31'
    OR p_settled_against IS NULL OR char_length(trim(p_settled_against)) NOT BETWEEN 3 AND 300
    OR char_length(COALESCE(p_notes, '')) > 500
  THEN RAISE EXCEPTION 'INVALID_SETTLEMENT'; END IF;

  IF p_advance_kind = 'PAYMENT' THEN
    SELECT p.unit_id INTO v_unit_id
    FROM public.payments p
    WHERE p.id = p_advance_id AND p.society_id = p_society_id
      AND p.is_voided = false AND p.unapplied_amount > 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_ADVANCE_NOT_FOUND'; END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_unit_id::text, 0));

    IF p_bill_id IS NOT NULL THEN
      SELECT * INTO v_bill
      FROM public.bills b
      WHERE b.id = p_bill_id AND b.society_id = p_society_id
        AND b.unit_id = v_unit_id AND b.is_voided = false
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'BILL_NOT_FOUND'; END IF;
      IF v_bill.status = 'PAID' THEN RAISE EXCEPTION 'BILL_ALREADY_PAID'; END IF;
      IF v_bill.status NOT IN ('ISSUED', 'OVERDUE') THEN RAISE EXCEPTION 'BILL_NOT_PAYABLE'; END IF;
      IF p_settled_amount > v_bill.payable_amount - v_bill.amount_settled THEN
        RAISE EXCEPTION 'SETTLEMENT_EXCEEDS_BILL';
      END IF;
    END IF;

    SELECT p.unapplied_amount INTO v_available
    FROM public.payments p
    WHERE p.id = p_advance_id AND p.society_id = p_society_id
      AND p.unit_id = v_unit_id AND p.is_voided = false AND p.unapplied_amount > 0
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_ADVANCE_NOT_FOUND'; END IF;
  ELSE
    IF p_bill_id IS NOT NULL THEN RAISE EXCEPTION 'EXPENSE_ADVANCE_HAS_NO_BILL'; END IF;
    SELECT e.amount INTO v_available
    FROM public.expenditures e
    WHERE e.id = p_advance_id AND e.society_id = p_society_id
      AND e.is_voided = false AND e.category = 'ADVANCE_PAYMENT'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_ADVANCE_NOT_FOUND'; END IF;
    SELECT COALESCE(SUM(s.settled_amount), 0) INTO v_already_settled
    FROM public.advance_settlements s
    WHERE s.society_id = p_society_id AND s.advance_kind = 'EXPENSE'
      AND s.advance_id = p_advance_id AND s.is_voided = false;
    v_available := v_available - v_already_settled;
  END IF;

  IF p_settled_amount > v_available THEN RAISE EXCEPTION 'SETTLEMENT_EXCEEDS_REMAINING'; END IF;

  IF p_bill_id IS NOT NULL THEN
    UPDATE public.bills b
    SET amount_settled = b.amount_settled + p_settled_amount,
        status = CASE WHEN b.amount_settled + p_settled_amount >= b.payable_amount
          THEN 'PAID'::public.bill_status ELSE b.status END
    WHERE b.id = p_bill_id;
  END IF;

  IF p_advance_kind = 'PAYMENT' THEN
    UPDATE public.payments p
    SET unapplied_amount = p.unapplied_amount - p_settled_amount,
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

CREATE OR REPLACE FUNCTION public.raise_levy_assessment(
  p_society_id uuid, p_levy_label text, p_amount numeric
)
RETURNS TABLE(created_count integer, skipped_count integer, total_units integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_created integer; v_total integer;
BEGIN
  PERFORM private.assert_whole_paise(p_amount);
  IF p_society_id IS NULL OR p_levy_label IS NULL OR char_length(trim(p_levy_label)) = 0
    OR NOT EXISTS (
      SELECT 1 FROM public.levy_configs lc
      WHERE lc.society_id = p_society_id
        AND lc.levy_label = p_levy_label
        AND lc.is_active_for_new_collections = true
    )
  THEN RAISE EXCEPTION 'INVALID_LEVY_ASSESSMENT'; END IF;

  SELECT count(*) INTO v_total FROM public.units
  WHERE society_id = p_society_id AND is_active = true AND is_test_unit = false;

  WITH inserted AS (
    INSERT INTO public.levy_assessments (society_id, unit_id, levy_label, amount)
    SELECT p_society_id, u.id, p_levy_label, p_amount
    FROM public.units u
    WHERE u.society_id = p_society_id AND u.is_active = true AND u.is_test_unit = false
    ON CONFLICT (society_id, unit_id, levy_label) WHERE NOT is_voided DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_created FROM inserted;
  RETURN QUERY SELECT v_created, v_total - v_created, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.raise_levy_assessment(uuid, text, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_levy_assessment(uuid, text, numeric)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_levy_collection(
  p_society_id uuid, p_unit_id uuid, p_resident_id uuid, p_levy_label text,
  p_amount_paid numeric, p_payment_date date, p_payment_mode text,
  p_notes text, p_recorded_by text
)
RETURNS public.amc_collections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_collection public.amc_collections;
  v_assessment public.levy_assessments%ROWTYPE;
BEGIN
  IF p_society_id IS NULL OR (SELECT auth.uid()) IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  PERFORM private.assert_whole_paise(p_amount_paid);
  IF p_unit_id IS NULL OR p_levy_label IS NULL OR char_length(trim(p_levy_label)) = 0
    OR p_amount_paid > 50000
  THEN RAISE EXCEPTION 'INVALID_LEVY_COLLECTION'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_unit_id::text, 0));

  SELECT * INTO v_assessment
  FROM public.levy_assessments a
  WHERE a.society_id = p_society_id AND a.unit_id = p_unit_id
    AND a.levy_label = p_levy_label AND a.is_voided = false
  FOR UPDATE;

  IF v_assessment.id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.levy_configs lc
    WHERE lc.society_id = p_society_id
      AND lc.levy_label = p_levy_label
      AND lc.is_active_for_new_collections = true
  ) THEN
    RAISE EXCEPTION 'LEVY_LABEL_INACTIVE';
  END IF;

  IF v_assessment.id IS NOT NULL THEN
    IF v_assessment.amount_settled >= v_assessment.amount THEN
      RAISE EXCEPTION 'LEVY_ALREADY_SETTLED';
    END IF;
    IF v_assessment.amount_settled + p_amount_paid > v_assessment.amount THEN
      RAISE EXCEPTION 'COLLECTION_EXCEEDS_ASSESSMENT';
    END IF;
  END IF;

  INSERT INTO public.amc_collections (
    unit_id, society_id, resident_id, levy_label, amount_paid, payment_date,
    payment_mode, notes, recorded_by
  ) VALUES (
    p_unit_id, p_society_id, p_resident_id, p_levy_label, p_amount_paid, p_payment_date,
    COALESCE(p_payment_mode, 'MANUAL_COLLECTION'), p_notes, p_recorded_by
  ) RETURNING * INTO v_collection;

  IF v_assessment.id IS NOT NULL THEN
    UPDATE public.levy_assessments
    SET amount_settled = amount_settled + p_amount_paid,
        status = CASE WHEN amount_settled + p_amount_paid >= amount THEN 'PAID' ELSE 'PENDING' END
    WHERE id = v_assessment.id;
  END IF;
  RETURN v_collection;
END;
$$;

REVOKE ALL ON FUNCTION public.record_levy_collection(uuid, uuid, uuid, text, numeric, date, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_levy_collection(uuid, uuid, uuid, text, numeric, date, text, text, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
