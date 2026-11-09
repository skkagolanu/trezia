-- Flat account dues summary.

CREATE OR REPLACE VIEW public.v_dues_summary WITH (security_invoker = true) AS
WITH bill_dues AS (
  SELECT
    b.unit_id,
    count(*) AS unpaid_months,
    sum(greatest(b.payable_amount - b.amount_settled, 0)) AS maintenance_due
  FROM public.bills b
  WHERE b.is_voided = false
    AND b.status IN ('ISSUED', 'OVERDUE')
    AND b.payable_amount - b.amount_settled > 0.005
  GROUP BY b.unit_id
),
levy_dues AS (
  SELECT
    a.unit_id,
    count(*) AS unpaid_levies,
    sum(greatest(a.amount - a.amount_settled, 0)) AS levy_due
  FROM public.levy_assessments a
  WHERE a.is_voided = false
    AND a.status = 'PENDING'
    AND a.amount - a.amount_settled > 0.005
  GROUP BY a.unit_id
),
last_receipt AS (
  SELECT receipts.unit_id, max(receipts.received_on) AS last_paid_date
  FROM (
    SELECT p.unit_id, p.payment_date AS received_on
    FROM public.payments p
    WHERE p.is_voided = false
    UNION ALL
    SELECT c.unit_id, c.payment_date AS received_on
    FROM public.amc_collections c
    WHERE c.is_voided = false
  ) receipts
  GROUP BY receipts.unit_id
)
SELECT
  u.flat_number,
  r.full_name AS primary_resident,
  r.phone,
  r.email,
  coalesce(bd.unpaid_months, 0) AS unpaid_months,
  coalesce(bd.maintenance_due, 0) + coalesce(ld.levy_due, 0) AS total_due,
  lr.last_paid_date,
  u.society_id,
  -- New columns are appended after migration 069's existing view signature;
  -- PostgreSQL CREATE OR REPLACE VIEW does not permit reordering old columns.
  coalesce(ld.unpaid_levies, 0) AS unpaid_levies,
  coalesce(bd.maintenance_due, 0) AS maintenance_due,
  coalesce(ld.levy_due, 0) AS levy_due
FROM public.units u
LEFT JOIN LATERAL (
  SELECT res.full_name, res.phone, res.email
  FROM public.residents res
  WHERE res.unit_id = u.id
    AND res.is_primary = true
    AND res.is_active = true
  ORDER BY res.created_at, res.id
  LIMIT 1
) r ON true
LEFT JOIN bill_dues bd ON bd.unit_id = u.id
LEFT JOIN levy_dues ld ON ld.unit_id = u.id
LEFT JOIN last_receipt lr ON lr.unit_id = u.id
WHERE u.is_active = true
  AND u.is_test_unit = false
ORDER BY u.flat_number;

CREATE OR REPLACE FUNCTION public.get_community_dues()
RETURNS TABLE(flat_number text, total_due numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  WITH target_units AS (
    SELECT u.id, u.flat_number, u.society_id
    FROM public.societies s
    JOIN public.units u
      ON u.society_id = s.id
     AND u.is_active = true
     AND u.is_test_unit = false
    WHERE s.slug = (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-society-slug')
      AND (
        private.auth_membership_role(s.id) IN ('admin', 'treasurer', 'resident')
        OR private.auth_platform_suspended_read(s.id)
      )
  ),
  bill_dues AS (
    SELECT b.unit_id, sum(greatest(b.payable_amount - b.amount_settled, 0)) AS amount
    FROM public.bills b
    JOIN target_units u ON u.id = b.unit_id AND u.society_id = b.society_id
    WHERE b.is_voided = false
      AND b.status IN ('ISSUED', 'OVERDUE')
      AND b.payable_amount - b.amount_settled > 0.005
    GROUP BY b.unit_id
  ),
  levy_dues AS (
    SELECT a.unit_id, sum(greatest(a.amount - a.amount_settled, 0)) AS amount
    FROM public.levy_assessments a
    JOIN target_units u ON u.id = a.unit_id AND u.society_id = a.society_id
    WHERE a.is_voided = false
      AND a.status = 'PENDING'
      AND a.amount - a.amount_settled > 0.005
    GROUP BY a.unit_id
  )
  SELECT
    u.flat_number,
    (coalesce(b.amount, 0) + coalesce(l.amount, 0))::numeric AS total_due
  FROM target_units u
  LEFT JOIN bill_dues b ON b.unit_id = u.id
  LEFT JOIN levy_dues l ON l.unit_id = u.id
  ORDER BY u.flat_number;
$$;

REVOKE ALL ON FUNCTION public.get_community_dues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_dues() TO authenticated;

NOTIFY pgrst, 'reload schema';
