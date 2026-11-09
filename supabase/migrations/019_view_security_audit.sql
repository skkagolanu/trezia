-- View security audit.

CREATE OR REPLACE VIEW v_dues_summary WITH (security_invoker = true) AS
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

CREATE OR REPLACE VIEW v_monthly_collections WITH (security_invoker = true) AS
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

CREATE OR REPLACE VIEW v_monthly_expenditures WITH (security_invoker = true) AS
SELECT
  DATE_TRUNC('month', expense_date) AS month,
  category,
  SUM(amount)                       AS total_amount,
  COUNT(*)                          AS line_count
FROM expenditures
WHERE NOT is_voided
GROUP BY DATE_TRUNC('month', expense_date), category
ORDER BY month DESC, total_amount DESC;

-- ── Audit triggers: close the coverage gap ─────────────────────────────────────────────

CREATE TRIGGER trg_audit_amc_collections
  AFTER INSERT OR UPDATE ON amc_collections
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER trg_audit_levy_configs
  AFTER INSERT OR UPDATE ON levy_configs
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();
