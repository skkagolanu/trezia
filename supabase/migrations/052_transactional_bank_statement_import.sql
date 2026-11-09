-- Transactional bank statement import.
CREATE OR REPLACE FUNCTION public.create_bank_statement_batch(
  p_society_id uuid,
  p_filename text,
  p_statement_from date,
  p_statement_to date,
  p_lines jsonb
)
RETURNS public.bank_statement_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch public.bank_statement_batches%ROWTYPE;
  v_line jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL
    OR p_society_id IS NULL
    OR private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION 'FINANCE_AUTHORITY_REQUIRED';
  END IF;

  BEGIN
    IF p_filename IS NOT NULL AND char_length(p_filename) > 255 THEN
      RAISE EXCEPTION 'invalid filename';
    END IF;

    IF p_statement_from IS NULL
      OR p_statement_to IS NULL
      OR p_statement_from > p_statement_to
      OR p_statement_from < DATE '1900-01-01'
      OR p_statement_to > (current_date + INTERVAL '1 year')::date
    THEN
      RAISE EXCEPTION 'invalid statement range';
    END IF;

    IF p_lines IS NULL
      OR jsonb_typeof(p_lines) <> 'array'
      OR jsonb_array_length(p_lines) = 0
      OR jsonb_array_length(p_lines) > 20000
      OR pg_column_size(p_lines) > 4000000
    THEN
      RAISE EXCEPTION 'invalid statement lines';
    END IF;

    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
    LOOP
      IF jsonb_typeof(v_line) IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_line -> 'line_date') IS DISTINCT FROM 'string'
        OR (v_line ->> 'line_date') !~ '^\d{4}-\d{2}-\d{2}$'
        OR (v_line ->> 'line_date')::date < p_statement_from
        OR (v_line ->> 'line_date')::date > p_statement_to
        OR jsonb_typeof(v_line -> 'description') IS DISTINCT FROM 'string'
        OR char_length(btrim(v_line ->> 'description')) = 0
        OR char_length(v_line ->> 'description') > 500
        OR jsonb_typeof(v_line -> 'amount') IS DISTINCT FROM 'number'
        OR (v_line ->> 'amount')::numeric = 0
        OR abs((v_line ->> 'amount')::numeric) > 9999999999.99
        OR (
          v_line ? 'reference'
          AND jsonb_typeof(v_line -> 'reference') IS DISTINCT FROM 'string'
          AND jsonb_typeof(v_line -> 'reference') IS DISTINCT FROM 'null'
        )
        OR char_length(COALESCE(v_line ->> 'reference', '')) > 255
      THEN
        RAISE EXCEPTION 'invalid statement line';
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'INVALID_BANK_STATEMENT_IMPORT';
  END;

  INSERT INTO public.bank_statement_batches (
    society_id,
    filename,
    statement_from,
    statement_to,
    line_count,
    uploaded_by
  ) VALUES (
    p_society_id,
    p_filename,
    p_statement_from,
    p_statement_to,
    jsonb_array_length(p_lines),
    (SELECT auth.uid())
  )
  RETURNING * INTO v_batch;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.bank_statement_lines (
      batch_id,
      line_date,
      description,
      amount,
      reference
    ) VALUES (
      v_batch.id,
      (v_line ->> 'line_date')::date,
      v_line ->> 'description',
      (v_line ->> 'amount')::numeric,
      NULLIF(v_line ->> 'reference', '')
    );
  END LOOP;

  RETURN v_batch;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bank_statement_batch(uuid, text, date, date, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_bank_statement_batch(uuid, text, date, date, jsonb)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
