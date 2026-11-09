import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/044_fy_treasurer_by_record_date.sql'),
  'utf8',
);
const membershipSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/046_membership_rls_and_access_lifecycle.sql'),
  'utf8',
);

describe('FY treasurer record-date migration', () => {
  it.each([
    ['payments', 'payment_date'],
    ['expenditures', 'expense_date'],
    ['amc_collections', 'payment_date'],
    ['other_income', 'income_date'],
  ])('backfills %s using %s', (table, dateColumn) => {
    expect(sql).toContain(`UPDATE public.${table}`);
    expect(sql).toContain(dateColumn);
  });

  it('keeps the save Admin-only, society-scoped, and authenticated', () => {
    expect(sql).toContain('p_society_id uuid');
    expect(membershipSql).toContain('private.auth_society_admin(p_society_id)');
    expect(membershipSql).toContain('WHERE society_id = p_society_id');
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.set_fy_treasurer_and_backfill');
    expect(sql).toContain('TO authenticated;');
  });
});
