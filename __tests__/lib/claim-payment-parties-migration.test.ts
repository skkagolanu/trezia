import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/078_claim_payment_parties.sql'),
  'utf8',
);

describe('accepted resident proof party attribution', () => {
  it('stamps both resident and treasurer without rewriting receipt facts', () => {
    expect(sql).toContain('v_claim.submitted_by');
    expect(sql).toContain('v_resident_id, v_recorded_by');
    expect(sql).toContain('resident_id, recorded_by, months_covered');
    expect(sql).toContain('society_id, resident_id, levy_label');
    expect(sql).not.toMatch(/SET\s+amount_paid\s*=/i);
    expect(sql).not.toMatch(/SET\s+payment_date\s*=/i);
    expect(sql).not.toMatch(/SET\s+utr_reference\s*=/i);
  });

  it('preserves the global unit-before-payment lock order', () => {
    for (const functionName of ['public.approve_resident_payment_claim', 'public.approve_resident_levy_claim']) {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${functionName}`);
      const body = sql.slice(start, sql.indexOf('$$;', start) + 3);
      expect(body.indexOf('pg_advisory_xact_lock')).toBeGreaterThan(-1);
      expect(body.indexOf('pg_advisory_xact_lock')).toBeLessThan(body.indexOf('FOR UPDATE'));
    }
  });

  it('runs for future approvals and repairs existing accepted claims', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.approve_resident_payment_claim');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.approve_resident_levy_claim');
    expect(sql).toContain("WHERE c.status = 'approved'");
    expect(sql).toContain('UPDATE public.payments p');
    expect(sql).toContain('UPDATE public.amc_collections a');
  });
});
