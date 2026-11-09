import { readFileSync } from 'fs';
import { join } from 'path';

const memberships = readFileSync(join(process.cwd(), 'supabase/migrations/045_multi_society_memberships.sql'), 'utf8');
const cutover = readFileSync(join(process.cwd(), 'supabase/migrations/046_membership_rls_and_access_lifecycle.sql'), 'utf8');
const inviteActorRepair = readFileSync(join(process.cwd(), 'supabase/migrations/049_fix_access_invite_actor_column.sql'), 'utf8');
const residentMonthlySummary = readFileSync(join(process.cwd(), 'supabase/migrations/050_resident_monthly_summary.sql'), 'utf8');

describe('multi-society membership migrations', () => {
  it('separates platform ownership from per-society authority', () => {
    expect(memberships).toContain('CREATE TABLE IF NOT EXISTS public.platform_owners');
    expect(memberships).toContain('CREATE TABLE IF NOT EXISTS public.society_memberships');
    expect(memberships).toContain("role IN ('admin', 'treasurer', 'committee', 'auditor', 'resident')");
    expect(memberships).not.toContain('contact@example.test');
    expect(memberships).toContain("m.user_id = (SELECT auth.uid()) AND m.role = 'admin' AND m.status = 'active'");
  });

  it('removes singleton defaults and enforces membership-scoped RLS', () => {
    expect(cutover).toContain('ALTER COLUMN society_id DROP DEFAULT');
    expect(cutover).toContain('private.auth_society_finance(society_id)');
    expect(cutover).toContain('private.auth_platform_suspended_read(society_id)');
    expect(cutover).toContain('ALTER VIEW public.v_dues_summary SET (security_invoker = true)');
    expect(cutover).toContain("pg_advisory_xact_lock(hashtextextended(OLD.society_id::text, 0))");
    expect(cutover).toContain('WITH CHECK (private.auth_society_finance(society_id))');
    expect(cutover).toContain('CREATE OR REPLACE FUNCTION public.get_community_dues()');
    expect(cutover).toContain("private.auth_membership_role(s.id) IN ('admin', 'treasurer', 'resident')");
    expect(cutover).toContain('CREATE FUNCTION public.get_public_privacy_contact(p_society_slug text)');
    expect(cutover).toContain('WHERE s.slug = lower(trim(p_society_slug))');
    expect(cutover).toContain('FINAL_ADMIN_REQUIRED');
    expect(cutover).toContain('PLATFORM_OWNER_ADMIN_REQUIRED');
  });

  it('claims every compatible authorization and revokes one membership softly', () => {
    expect(cutover).toContain('claim_access_authorizations');
    expect(cutover).toContain('FOR v_invite IN');
    expect(cutover).toContain("status = 'revoked'");
    expect(cutover).not.toContain('DELETE FROM public.profiles');
  });

  it('repairs the invite actor column without widening RPC execution', () => {
    expect(inviteActorRepair).toContain('user_id = p_actor_id AND society_id = p_society_id');
    expect(inviteActorRepair).toContain("role = 'admin' AND status = 'active'");
    expect(inviteActorRepair).toContain("RAISE EXCEPTION 'ADMIN_REQUIRED'");
    expect(inviteActorRepair).toContain(
      "SELECT 1 FROM public.societies WHERE id = p_society_id AND status = 'active'",
    );
    expect(inviteActorRepair).toContain("RAISE EXCEPTION 'SOCIETY_SUSPENDED'");
    expect(inviteActorRepair).toContain("p_role NOT IN ('resident', 'treasurer')");
    expect(inviteActorRepair).toContain("RAISE EXCEPTION 'ROLE_NOT_INVITABLE'");
    expect(inviteActorRepair).toContain("(p_role = 'resident') <> (p_unit_id IS NOT NULL)");
    expect(inviteActorRepair).toContain("RAISE EXCEPTION 'INVALID_ROLE_UNIT'");
    expect(inviteActorRepair).toContain('WHERE id = p_unit_id AND society_id = p_society_id');
    expect(inviteActorRepair).toContain("RAISE EXCEPTION 'UNIT_NOT_IN_SOCIETY'");
    expect(inviteActorRepair).toContain(
      "hashtextextended(p_society_id::text || ':' || lower(trim(p_email)), 0)",
    );
    expect(inviteActorRepair).toContain(
      'INSERT INTO public.resident_invites (society_id, email, role, unit_id, invited_by)',
    );
    expect(inviteActorRepair).toContain('invited_by = p_actor_id, created_at = now()');
    expect(inviteActorRepair).not.toContain('created_by');
    expect(inviteActorRepair).toContain('JOIN auth.users u ON u.id = m.user_id');
    expect(inviteActorRepair).toContain(
      '(m.role <> p_role OR m.unit_id IS DISTINCT FROM p_unit_id)',
    );
    expect(inviteActorRepair).toContain("RAISE EXCEPTION 'ACTIVE_ACCESS_EXISTS'");
    expect(inviteActorRepair).toContain("RAISE EXCEPTION 'PENDING_ACCESS_EXISTS'");
    expect(inviteActorRepair).toContain(
      'REVOKE ALL ON FUNCTION public.create_access_invite(uuid, text, text, uuid, uuid)',
    );
    expect(inviteActorRepair).toContain('FROM PUBLIC, anon, authenticated');
    expect(inviteActorRepair).toContain(
      'GRANT EXECUTE ON FUNCTION public.create_access_invite(uuid, text, text, uuid, uuid)',
    );
    expect(inviteActorRepair).toContain('TO service_role');
  });

  it('exposes only a current-month, resident-authorized society summary', () => {
    expect(residentMonthlySummary).toContain(
      'CREATE OR REPLACE FUNCTION public.get_resident_monthly_summary()',
    );
    expect(residentMonthlySummary).toContain(
      "current_setting('request.headers', true)",
    );
    expect(residentMonthlySummary).toContain("->> 'x-society-slug'");
    expect(residentMonthlySummary).not.toContain('p_society_id');
    expect(residentMonthlySummary).toContain("s.status = 'active'");
    expect(residentMonthlySummary).toContain('(SELECT auth.uid()) IS NULL');
    expect(residentMonthlySummary).toContain(
      "private.auth_membership_role(v_society_id) IS DISTINCT FROM 'resident'",
    );
    expect(residentMonthlySummary).toContain("RAISE EXCEPTION 'NOT_AUTHORIZED'");

    expect(residentMonthlySummary).toContain(
      "v_month_start date := date_trunc('month', CURRENT_DATE)::date",
    );
    expect(residentMonthlySummary).toContain(
      "v_next_month date := (date_trunc('month', CURRENT_DATE) + interval '1 month')::date",
    );
    expect(residentMonthlySummary).toContain('p.payment_date >= v_month_start');
    expect(residentMonthlySummary).toContain('p.payment_date < v_next_month');
    expect(residentMonthlySummary).toContain('a.payment_date >= v_month_start');
    expect(residentMonthlySummary).toContain('i.income_date >= v_month_start');
    expect(residentMonthlySummary).toContain('e.expense_date >= v_month_start');

    expect(residentMonthlySummary).toContain('p.is_voided = false');
    expect(residentMonthlySummary).toContain('a.is_voided = false');
    expect(residentMonthlySummary).toContain('i.is_voided = false');
    expect(residentMonthlySummary).toContain('e.is_voided = false');
    expect(residentMonthlySummary.match(/u\.is_test_unit = false/g)).toHaveLength(2);

    expect(residentMonthlySummary).toContain(
      'RETURNS TABLE(month_start date, total_collected numeric, total_spent numeric)',
    );
    expect(residentMonthlySummary).not.toMatch(
      /RETURNS TABLE\([^)]*(flat|name|email|phone|unit_id|society_id)/i,
    );
    expect(residentMonthlySummary).toContain(
      'REVOKE ALL ON FUNCTION public.get_resident_monthly_summary() FROM PUBLIC, anon, service_role',
    );
    expect(residentMonthlySummary).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_resident_monthly_summary() TO authenticated',
    );
    expect(residentMonthlySummary).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
