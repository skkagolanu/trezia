-- Fy treasurer by record date.

ALTER TABLE public.other_income
  ADD COLUMN IF NOT EXISTS recorded_by text;


UPDATE public.payments p
SET recorded_by = r.full_name
FROM public.fy_treasurers ft
JOIN public.residents r ON r.id = ft.resident_id AND r.society_id = ft.society_id
WHERE p.society_id = ft.society_id
  AND p.payment_date BETWEEN make_date(ft.fy_start_year, 4, 1)
                         AND make_date(ft.fy_start_year + 1, 3, 31);

UPDATE public.expenditures e
SET recorded_by = r.full_name
FROM public.fy_treasurers ft
JOIN public.residents r ON r.id = ft.resident_id AND r.society_id = ft.society_id
WHERE e.society_id = ft.society_id
  AND e.expense_date BETWEEN make_date(ft.fy_start_year, 4, 1)
                         AND make_date(ft.fy_start_year + 1, 3, 31);

UPDATE public.amc_collections a
SET recorded_by = r.full_name
FROM public.fy_treasurers ft
JOIN public.residents r ON r.id = ft.resident_id AND r.society_id = ft.society_id
WHERE a.society_id = ft.society_id
  AND COALESCE(a.payment_date, a.created_at::date)
      BETWEEN make_date(ft.fy_start_year, 4, 1)
          AND make_date(ft.fy_start_year + 1, 3, 31);

UPDATE public.other_income o
SET recorded_by = r.full_name
FROM public.fy_treasurers ft
JOIN public.residents r ON r.id = ft.resident_id AND r.society_id = ft.society_id
WHERE o.society_id = ft.society_id
  AND o.income_date BETWEEN make_date(ft.fy_start_year, 4, 1)
                        AND make_date(ft.fy_start_year + 1, 3, 31);

CREATE OR REPLACE FUNCTION public.set_fy_treasurer_and_backfill(
  p_society_id uuid,
  p_fy_start_year integer,
  p_resident_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_name text;
  v_mapping_id uuid;
  v_from date;
  v_to date;
  v_payments integer;
  v_expenses integer;
  v_levies integer;
  v_income integer;
BEGIN
  IF NOT (SELECT public.auth_admin_tier()) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF p_fy_start_year < 2000 OR p_fy_start_year > 2100 THEN
    RAISE EXCEPTION 'INVALID_FINANCIAL_YEAR';
  END IF;

  IF p_society_id IS NULL OR p_society_id <> (SELECT public.auth_profile_society_id()) THEN
    RAISE EXCEPTION 'SOCIETY_NOT_AUTHORIZED';
  END IF;

  SELECT full_name INTO v_name
  FROM public.residents
  WHERE id = p_resident_id AND society_id = p_society_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'RESIDENT_NOT_IN_SOCIETY';
  END IF;

  INSERT INTO public.fy_treasurers (society_id, fy_start_year, resident_id)
  VALUES (p_society_id, p_fy_start_year, p_resident_id)
  ON CONFLICT (society_id, fy_start_year)
  DO UPDATE SET resident_id = EXCLUDED.resident_id
  RETURNING id INTO v_mapping_id;

  v_from := make_date(p_fy_start_year, 4, 1);
  v_to := make_date(p_fy_start_year + 1, 3, 31);

  UPDATE public.payments
  SET recorded_by = v_name
  WHERE society_id = p_society_id AND payment_date BETWEEN v_from AND v_to;
  GET DIAGNOSTICS v_payments = ROW_COUNT;

  UPDATE public.expenditures
  SET recorded_by = v_name
  WHERE society_id = p_society_id AND expense_date BETWEEN v_from AND v_to;
  GET DIAGNOSTICS v_expenses = ROW_COUNT;

  UPDATE public.amc_collections
  SET recorded_by = v_name
  WHERE society_id = p_society_id
    AND COALESCE(payment_date, created_at::date) BETWEEN v_from AND v_to;
  GET DIAGNOSTICS v_levies = ROW_COUNT;

  UPDATE public.other_income
  SET recorded_by = v_name
  WHERE society_id = p_society_id AND income_date BETWEEN v_from AND v_to;
  GET DIAGNOSTICS v_income = ROW_COUNT;

  RETURN jsonb_build_object(
    'id', v_mapping_id,
    'fy_start_year', p_fy_start_year,
    'resident_id', p_resident_id,
    'updated', jsonb_build_object(
      'payments', v_payments,
      'expenses', v_expenses,
      'levies', v_levies,
      'other_income', v_income
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_fy_treasurer_and_backfill(uuid, integer, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_fy_treasurer_and_backfill(uuid, integer, uuid)
  TO authenticated;
