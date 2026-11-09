-- Fix monthly collections voided.
CREATE OR REPLACE VIEW v_monthly_collections AS
SELECT
  DATE_TRUNC('month', payment_date)                               AS month,
  COUNT(*) FILTER (WHERE NOT is_voided)                          AS payment_count,
  SUM(amount_paid) FILTER (WHERE NOT is_voided)                  AS total_collected,
  SUM(amount_paid) FILTER (WHERE payment_mode = 'UPI'
                              AND NOT is_voided)                  AS upi_total,
  SUM(amount_paid) FILTER (WHERE payment_mode = 'CASH'
                              AND NOT is_voided)                  AS cash_total,
  SUM(amount_paid) FILTER (WHERE payment_mode = 'NOBROKER_HOOD'
                              AND NOT is_voided)                  AS nn_total,
  SUM(amount_paid) FILTER (WHERE is_voided = TRUE)               AS voided_total
FROM payments
GROUP BY DATE_TRUNC('month', payment_date)
ORDER BY month DESC;
