-- Resident monthly summary.
CREATE OR REPLACE FUNCTION public.get_resident_monthly_summary()
RETURNS TABLE(month_start date, total_collected numeric, total_spent numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_society_id uuid;
  v_month_start date := date_trunc('month', CURRENT_DATE)::date;
  v_next_month date := (date_trunc('month', CURRENT_DATE) + interval '1 month')::date;
BEGIN
  SELECT s.id
  INTO v_society_id
  FROM public.societies s
  WHERE s.slug = COALESCE(
    NULLIF(current_setting('request.headers', true), '')::jsonb ->> 'x-society-slug',
    ''
  )
    AND s.status = 'active';

  IF (SELECT auth.uid()) IS NULL
    OR v_society_id IS NULL
    OR private.auth_membership_role(v_society_id) IS DISTINCT FROM 'resident'
  THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  RETURN QUERY
  SELECT
    v_month_start,
    (
      COALESCE((
        SELECT SUM(p.amount_paid)
        FROM public.payments p
        JOIN public.units u
          ON u.id = p.unit_id
         AND u.society_id = p.society_id
         AND u.is_test_unit = false
        WHERE p.society_id = v_society_id
          AND p.is_voided = false
          AND p.payment_date >= v_month_start
          AND p.payment_date < v_next_month
      ), 0)
      + COALESCE((
        SELECT SUM(a.amount_paid)
        FROM public.amc_collections a
        JOIN public.units u
          ON u.id = a.unit_id
         AND u.society_id = a.society_id
         AND u.is_test_unit = false
        WHERE a.society_id = v_society_id
          AND a.is_voided = false
          AND a.payment_date >= v_month_start
          AND a.payment_date < v_next_month
      ), 0)
      + COALESCE((
        SELECT SUM(i.amount)
        FROM public.other_income i
        WHERE i.society_id = v_society_id
          AND i.is_voided = false
          AND i.income_date >= v_month_start
          AND i.income_date < v_next_month
      ), 0)
    )::numeric AS total_collected,
    COALESCE((
      SELECT SUM(e.amount)
      FROM public.expenditures e
      WHERE e.society_id = v_society_id
        AND e.is_voided = false
        AND e.expense_date >= v_month_start
        AND e.expense_date < v_next_month
    ), 0)::numeric AS total_spent;
END;
$$;

REVOKE ALL ON FUNCTION public.get_resident_monthly_summary() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_resident_monthly_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';
