-- Views.
CREATE OR REPLACE VIEW v_dues_summary AS
SELECT
  u.flat_number,
  r.full_name              AS primary_resident,
  r.phone,
  r.email,
  COUNT(b.id) FILTER (
    WHERE b.status IN ('ISSUED','OVERDUE') AND NOT b.is_voided
  )                        AS unpaid_months,
  SUM(b.payable_amount) FILTER (
    WHERE b.status IN ('ISSUED','OVERDUE') AND NOT b.is_voided
  )                        AS total_due,
  MAX(p.payment_date)      AS last_paid_date
FROM units u
LEFT JOIN residents r
  ON r.unit_id = u.id AND r.is_primary = TRUE AND r.is_active = TRUE
LEFT JOIN bills b
  ON b.unit_id = u.id
LEFT JOIN payments p
  ON p.unit_id = u.id AND NOT p.is_voided
WHERE u.is_active = TRUE
GROUP BY u.flat_number, r.full_name, r.phone, r.email
ORDER BY u.flat_number;

-- Monthly collection totals
CREATE OR REPLACE VIEW v_monthly_collections AS
SELECT
  DATE_TRUNC('month', payment_date)                               AS month,
  COUNT(*)                                                        AS payment_count,
  SUM(amount_paid)                                                AS total_collected,
  SUM(amount_paid) FILTER (WHERE payment_mode = 'UPI')           AS upi_total,
  SUM(amount_paid) FILTER (WHERE payment_mode = 'CASH')          AS cash_total,
  SUM(amount_paid) FILTER (WHERE payment_mode = 'NOBROKER_HOOD') AS nn_total,
  SUM(amount_paid) FILTER (WHERE is_voided = TRUE)               AS voided_total
FROM payments
GROUP BY DATE_TRUNC('month', payment_date)
ORDER BY month DESC;

-- Monthly expenditure by category
CREATE OR REPLACE VIEW v_monthly_expenditures AS
SELECT
  DATE_TRUNC('month', expense_date) AS month,
  category,
  SUM(amount)                       AS total_amount,
  COUNT(*)                          AS line_count
FROM expenditures
WHERE NOT is_voided
GROUP BY DATE_TRUNC('month', expense_date), category
ORDER BY month DESC, total_amount DESC;
