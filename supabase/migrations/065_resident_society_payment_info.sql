-- Resident society payment info.
CREATE OR REPLACE FUNCTION public.get_resident_society_payment_info()
RETURNS TABLE(society_name text, treasurer_mobile text, upi_id text, upi_qr_object_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_society_id uuid;
BEGIN
  SELECT s.id
  INTO v_society_id
  FROM public.societies s
  WHERE s.slug = COALESCE(
    NULLIF(current_setting('request.headers', true), '')::jsonb ->> 'x-society-slug',
    ''
  )
    AND s.status = 'active';

  -- Any active member of the requested society may read these four fields.
  -- Operators can already read them from the table; this keeps one code path.
  IF (SELECT auth.uid()) IS NULL
    OR v_society_id IS NULL
    OR private.auth_membership_role(v_society_id) IS NULL
  THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  RETURN QUERY
  SELECT c.name, c.mobile, c.upi_id, c.upi_qr_object_key
  FROM public.society_config c
  WHERE c.society_id = v_society_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_resident_society_payment_info() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_resident_society_payment_info() TO authenticated;

NOTIFY pgrst, 'reload schema';
