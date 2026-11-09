-- Transactional advance settlement.
CREATE OR REPLACE FUNCTION public.create_advance_settlement(
  p_society_id uuid,
  p_advance_kind text,
  p_advance_id uuid,
  p_settled_amount numeric,
  p_settled_against text,
  p_settled_date date,
  p_notes text DEFAULT NULL
)
RETURNS public.advance_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_original_amount numeric;
  v_already_settled numeric;
  v_settlement public.advance_settlements;
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
    SELECT p.amount_paid
    INTO v_original_amount
    FROM public.payments p
    WHERE p.id = p_advance_id
      AND p.society_id = p_society_id
      AND p.is_voided = false
      AND p.payment_mode = 'ADVANCE'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PAYMENT_ADVANCE_NOT_FOUND';
    END IF;
  ELSE
    SELECT e.amount
    INTO v_original_amount
    FROM public.expenditures e
    WHERE e.id = p_advance_id
      AND e.society_id = p_society_id
      AND e.is_voided = false
      AND e.category = 'ADVANCE_PAYMENT'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'EXPENSE_ADVANCE_NOT_FOUND';
    END IF;
  END IF;

  SELECT COALESCE(SUM(s.settled_amount), 0)
  INTO v_already_settled
  FROM public.advance_settlements s
  WHERE s.society_id = p_society_id
    AND s.advance_kind = p_advance_kind
    AND s.advance_id = p_advance_id
    AND s.is_voided = false;

  IF p_settled_amount > v_original_amount - v_already_settled THEN
    RAISE EXCEPTION 'SETTLEMENT_EXCEEDS_REMAINING';
  END IF;

  INSERT INTO public.advance_settlements (
    society_id,
    advance_kind,
    advance_id,
    settled_amount,
    settled_against,
    settled_date,
    notes
  ) VALUES (
    p_society_id,
    p_advance_kind,
    p_advance_id,
    p_settled_amount,
    trim(p_settled_against),
    p_settled_date,
    NULLIF(trim(p_notes), '')
  )
  RETURNING * INTO v_settlement;

  RETURN v_settlement;
END;
$$;

REVOKE ALL ON FUNCTION public.create_advance_settlement(uuid, text, uuid, numeric, text, date, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_advance_settlement(uuid, text, uuid, numeric, text, date, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
