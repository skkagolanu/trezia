-- Correct historical payment months.

BEGIN;

DO $$
DECLARE
  invalid_receipts text;
BEGIN
  SELECT string_agg(receipt_number, ', ' ORDER BY receipt_number)
  INTO invalid_receipts
  FROM (
    SELECT receipt_number
    FROM payments
    WHERE receipt_number ~ '^HIST-[0-9]+$'
      AND (
        months_covered IS DISTINCT FROM 1
        OR months_detail IS NULL
        OR months_detail !~ '^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4}$'
      )
    ORDER BY receipt_number
    LIMIT 25
  ) invalid;

  IF invalid_receipts IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 039 aborted: HIST rows outside the canonical single-month importer shape: %',
      invalid_receipts;
  END IF;

CREATE TEMP TABLE hist_month_correction ON COMMIT DROP AS
SELECT
  id AS payment_id,
  unit_id,
  EXTRACT(YEAR FROM old_period)::int  AS old_year,
  EXTRACT(MONTH FROM old_period)::int AS old_month,
  EXTRACT(YEAR FROM new_period)::int  AS new_year,
  EXTRACT(MONTH FROM new_period)::int AS new_month,
  to_char(new_period, 'Mon YYYY') AS new_label,
  needs_update
FROM (
  SELECT
    payment.id,
    payment.unit_id,
    COALESCE(
      to_date('01 ' || completed.old_label, 'DD Mon YYYY'),
      to_date('01 ' || payment.months_detail, 'DD Mon YYYY')
    ) AS old_period,
    CASE
      WHEN completed.old_label IS NOT NULL
        THEN to_date('01 ' || payment.months_detail, 'DD Mon YYYY')
      ELSE to_date('01 ' || payment.months_detail, 'DD Mon YYYY') + interval '1 month'
    END AS new_period,
    completed.old_label IS NULL AS needs_update
  FROM payments payment
  LEFT JOIN LATERAL (
    -- An exact old→new audit pair proves this row was already advanced. Keep
    -- it in the staging set for bill reconciliation, but never shift it twice.
    SELECT audit.old_data->>'months_detail' AS old_label
    FROM audit_log audit
    WHERE audit.table_name = 'payments'
      AND audit.record_id = payment.id::text
      AND audit.action = 'UPDATE'
      AND audit.new_data->>'months_detail' = payment.months_detail
      AND audit.old_data->>'months_detail' ~ '^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4}$'
      AND audit.new_data->>'months_detail' ~ '^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4}$'
      AND to_date('01 ' || (audit.old_data->>'months_detail'), 'DD Mon YYYY') + interval '1 month'
        = to_date('01 ' || (audit.new_data->>'months_detail'), 'DD Mon YYYY')
    ORDER BY audit.created_at DESC, audit.id DESC
    LIMIT 1
  ) completed ON true
  WHERE payment.receipt_number ~ '^HIST-[0-9]+$'
) canonical;

UPDATE payments p
SET months_detail = correction.new_label
FROM hist_month_correction correction
WHERE p.id = correction.payment_id
  AND correction.needs_update
  AND p.months_detail IS DISTINCT FROM correction.new_label;

CREATE TEMP TABLE affected_bill_periods ON COMMIT DROP AS
SELECT DISTINCT unit_id, year, month
FROM (
  SELECT unit_id, old_year AS year, old_month AS month FROM hist_month_correction
  UNION ALL
  SELECT unit_id, new_year AS year, new_month AS month FROM hist_month_correction
) periods;

-- Reconcile only periods touched by the correction. A period remains PAID if
-- any active payment covers it; otherwise past periods become OVERDUE and the
-- current/future period remains ISSUED. Voided and administrative bill states
-- are preserved.
UPDATE bills b
SET status = CASE
  WHEN EXISTS (
    SELECT 1
    FROM payments p
    CROSS JOIN LATERAL regexp_split_to_table(p.months_detail, ',') AS covered(label)
    WHERE p.unit_id = b.unit_id
      AND NOT p.is_voided
      AND trim(covered.label) = to_char(
        make_date(b.bill_period_year, b.bill_period_month, 1),
        'Mon YYYY'
      )
  ) THEN 'PAID'::bill_status
  WHEN make_date(b.bill_period_year, b.bill_period_month, 1)
       < date_trunc('month', current_date) THEN 'OVERDUE'::bill_status
  ELSE 'ISSUED'::bill_status
END
FROM affected_bill_periods affected
WHERE b.unit_id = affected.unit_id
  AND b.bill_period_year = affected.year
  AND b.bill_period_month = affected.month
  AND NOT b.is_voided
  AND b.status IN ('PAID', 'OVERDUE', 'ISSUED');

END;
$$;

COMMIT;
