-- Remove nobroker hood payment mode.
DROP VIEW IF EXISTS v_monthly_collections;

ALTER TABLE payments ALTER COLUMN payment_mode TYPE TEXT;

UPDATE payments SET payment_mode = 'OTHER' WHERE payment_mode = 'NOBROKER_HOOD';

DROP TYPE payment_mode;

CREATE TYPE payment_mode AS ENUM (
  'UPI',
  'CASH',
  'MANUAL_COLLECTION',
  'BANK_TRANSFER',
  'NEFT',
  'IMPS',
  'CHEQUE',
  'ADVANCE',
  'OTHER'
);

ALTER TABLE payments
  ALTER COLUMN payment_mode TYPE payment_mode USING payment_mode::payment_mode;

-- v_monthly_collections (last defined in migration 023) referenced
-- NOBROKER_HOOD in a FILTER clause and exposed a 'nn_total' column —
-- recreate without either; those payments now count toward the existing
-- 'OTHER' total, not a column of their own.
CREATE OR REPLACE VIEW v_monthly_collections WITH (security_invoker = true) AS
SELECT
  DATE_TRUNC('month', p.payment_date)                       AS month,
  COUNT(*)                                                   AS payment_count,
  SUM(p.amount_paid)                                         AS total_collected,
  SUM(p.amount_paid) FILTER (WHERE p.payment_mode = 'UPI')  AS upi_total,
  SUM(p.amount_paid) FILTER (WHERE p.payment_mode = 'CASH') AS cash_total,
  SUM(p.amount_paid) FILTER (WHERE p.is_voided = TRUE)      AS voided_total
FROM payments p
JOIN units u ON u.id = p.unit_id
WHERE NOT u.is_test_unit
GROUP BY DATE_TRUNC('month', p.payment_date)
ORDER BY month DESC;
