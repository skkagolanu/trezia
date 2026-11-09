-- Dues after payment window.
CREATE OR REPLACE VIEW v_dues_summary WITH (security_invoker = true) AS
WITH bill_dues AS (
  SELECT
    unit_id,
    COUNT(*) FILTER (
      WHERE NOT is_voided
        AND (
          status = 'OVERDUE'
          OR (status = 'ISSUED' AND due_date < current_date)
        )
    ) AS unpaid_months,
    SUM(payable_amount) FILTER (
      WHERE NOT is_voided
        AND (
          status = 'OVERDUE'
          OR (status = 'ISSUED' AND due_date < current_date)
        )
    ) AS total_due
  FROM bills
  GROUP BY unit_id
),
last_payment AS (
  SELECT unit_id, MAX(payment_date) AS last_paid_date
  FROM payments
  WHERE NOT is_voided
  GROUP BY unit_id
)
SELECT
  u.flat_number,
  r.full_name AS primary_resident,
  r.phone,
  r.email,
  COALESCE(bd.unpaid_months, 0) AS unpaid_months,
  COALESCE(bd.total_due, 0) AS total_due,
  lp.last_paid_date,
  u.society_id
FROM units u
LEFT JOIN residents r
  ON r.unit_id = u.id AND r.is_primary = TRUE AND r.is_active = TRUE
LEFT JOIN bill_dues bd ON bd.unit_id = u.id
LEFT JOIN last_payment lp ON lp.unit_id = u.id
WHERE u.is_active = TRUE
  AND NOT u.is_test_unit
ORDER BY u.flat_number;


CREATE OR REPLACE VIEW v_monthly_collections WITH (security_invoker = true) AS
SELECT
  DATE_TRUNC('month', p.payment_date) AS month,
  COUNT(*) FILTER (WHERE NOT p.is_voided) AS payment_count,
  SUM(p.amount_paid) FILTER (WHERE NOT p.is_voided) AS total_collected,
  SUM(p.amount_paid) FILTER (
    WHERE p.payment_mode = 'UPI' AND NOT p.is_voided
  ) AS upi_total,
  SUM(p.amount_paid) FILTER (
    WHERE p.payment_mode = 'CASH' AND NOT p.is_voided
  ) AS cash_total,
  SUM(p.amount_paid) FILTER (WHERE p.is_voided) AS voided_total,
  u.society_id
FROM payments p
JOIN units u ON u.id = p.unit_id
WHERE NOT u.is_test_unit
GROUP BY DATE_TRUNC('month', p.payment_date), u.society_id
ORDER BY month DESC;
