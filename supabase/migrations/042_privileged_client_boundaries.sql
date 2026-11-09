-- Privileged client boundaries.

GRANT SELECT ON public.resident_invites TO authenticated;

DROP POLICY IF EXISTS "resident_invites_admin_select" ON public.resident_invites;
CREATE POLICY "resident_invites_admin_select" ON public.resident_invites
  FOR SELECT TO authenticated
  USING (
    (SELECT public.auth_admin_tier())
    AND society_id = (SELECT public.auth_profile_society_id())
  );

CREATE OR REPLACE FUNCTION public.get_community_dues()
RETURNS TABLE(flat_number text, total_due numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.flat_number,
    COALESCE(SUM(
      CASE
        WHEN b.status = 'OVERDUE' THEN b.payable_amount
        WHEN b.status = 'ISSUED' AND b.due_date < CURRENT_DATE THEN b.payable_amount
        ELSE 0
      END
    ), 0)::numeric AS total_due
  FROM public.profiles p
  JOIN public.units u
    ON u.society_id = p.society_id
   AND u.is_active = true
   AND u.is_test_unit = false
  LEFT JOIN public.bills b
    ON b.unit_id = u.id
   AND b.society_id = p.society_id
   AND b.is_voided = false
   AND b.status IN ('OVERDUE', 'ISSUED')
  WHERE p.id = (SELECT auth.uid())
    AND p.role IN ('admin', 'treasurer', 'resident')
  GROUP BY u.id, u.flat_number
  ORDER BY u.flat_number;
$$;

REVOKE EXECUTE ON FUNCTION public.get_community_dues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_dues() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_privacy_contact()
RETURNS TABLE(name text, address text, mobile text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.name, c.address, c.mobile
  FROM public.society_config c
  ORDER BY c.id
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_privacy_contact() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_privacy_contact() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
