import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/076_flat_account_dues_summary.sql'),
  'utf8',
);

describe('flat-account dues summary migration', () => {
  it('totals outstanding maintenance and levy balances without joining the ledgers together', () => {
    expect(sql).toContain('WITH bill_dues AS');
    expect(sql).toContain('levy_dues AS');
    expect(sql).toContain('b.payable_amount - b.amount_settled');
    expect(sql).toContain('a.amount - a.amount_settled');
    expect(sql).toContain("b.status IN ('ISSUED', 'OVERDUE')");
    expect(sql).toContain("a.status = 'PENDING'");
    expect(sql).toContain('coalesce(bd.maintenance_due, 0) + coalesce(ld.levy_due, 0) AS total_due');
  });

  it('keeps community results redacted and tenant-scoped', () => {
    const communityFunction = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.get_community_dues()'));
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_community_dues()');
    expect(sql).toContain("private.auth_membership_role(s.id) IN ('admin', 'treasurer', 'resident')");
    expect(sql).toContain("current_setting('request.headers', true)");
    expect(communityFunction).not.toContain('full_name');
    expect(communityFunction).not.toContain('phone');
    expect(communityFunction).not.toContain('email');
  });
});
