-- Backfill bill statuses.

DO $$
DECLARE
  p           RECORD;
  raw_label   TEXT;
  month_label TEXT;
  month_abbr  TEXT;
  year_num    INT;
  month_num   INT;
BEGIN
  FOR p IN
    SELECT id, unit_id, months_detail
    FROM payments
    WHERE is_voided = false
      AND months_detail IS NOT NULL
      AND months_detail <> ''
  LOOP
    FOREACH raw_label IN ARRAY string_to_array(p.months_detail, ',') LOOP
      month_label := trim(raw_label);
      month_abbr  := split_part(month_label, ' ', 1);
      year_num    := split_part(month_label, ' ', 2)::int;
      month_num   := CASE month_abbr
        WHEN 'Jan' THEN 1  WHEN 'Feb' THEN 2  WHEN 'Mar' THEN 3
        WHEN 'Apr' THEN 4  WHEN 'May' THEN 5  WHEN 'Jun' THEN 6
        WHEN 'Jul' THEN 7  WHEN 'Aug' THEN 8  WHEN 'Sep' THEN 9
        WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12
        ELSE 0
      END;
      IF month_num > 0 THEN
        UPDATE bills
        SET    status = 'PAID'
        WHERE  unit_id           = p.unit_id
          AND  bill_period_year  = year_num
          AND  bill_period_month = month_num
          AND  is_voided         = false
          AND  status           <> 'PAID';
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
