import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/051_transactional_advance_settlement.sql'),
  'utf8',
);
const membershipSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/045_multi_society_memberships.sql'),
  'utf8',
);

describe('transactional advance settlement migration', () => {
  it('uses a definer transaction gated by the active finance membership and request slug', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('(SELECT auth.uid()) IS NULL');
    expect(sql).toContain('private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE');
    expect(membershipSql).toContain("m.status = 'active' AND s.status = 'active'");
    expect(membershipSql).toContain("current_setting('request.headers', true)");
  });

  it('locks and classifies the society-owned non-voided original record', () => {
    expect(sql).toContain("p.payment_mode = 'ADVANCE'");
    expect(sql).toContain("e.category = 'ADVANCE_PAYMENT'");
    expect(sql.match(/society_id = p_society_id/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/is_voided = false/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/FOR UPDATE/g)).toHaveLength(2);
  });

  it('sums every prior active settlement and rejects an over-settlement before insert', () => {
    expect(sql).toContain('COALESCE(SUM(s.settled_amount), 0)');
    expect(sql).toContain('p_settled_amount > v_original_amount - v_already_settled');
    expect(sql.indexOf('SETTLEMENT_EXCEEDS_REMAINING')).toBeLessThan(
      sql.indexOf('INSERT INTO public.advance_settlements'),
    );
  });

  it('validates inputs and exposes the RPC only to authenticated sessions', () => {
    expect(sql).toContain("p_settled_amount::text IN ('NaN', 'Infinity', '-Infinity')");
    expect(sql).toContain('char_length(trim(p_settled_against)) NOT BETWEEN 3 AND 300');
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.create_advance_settlement");
    expect(sql).toContain('FROM PUBLIC, anon, service_role;');
    expect(sql).toContain('TO authenticated;');
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
