import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/077_financial_trust_and_amc_consolidation.sql'),
  'utf8',
);
const amcOnlySql = readFileSync(
  join(process.cwd(), 'supabase/migrations/079_amc_only_configuration.sql'),
  'utf8',
);

function bodyOf(functionName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${functionName}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = sql.indexOf('CREATE OR REPLACE FUNCTION', start + 1);
  return sql.slice(start, next < 0 ? sql.length : next);
}

describe('migration 077 financial trust hardening', () => {
  it.each([
    'public.update_levy_collection_transactional',
    'public.void_levy_collection_transactional',
    'public.void_payment_transactional',
    'public.void_advance_settlement',
    'public.create_advance_settlement',
    'public.record_levy_collection',
  ])('%s takes the unit advisory lock before its first row lock', functionName => {
    const body = bodyOf(functionName);
    expect(body.indexOf('pg_advisory_xact_lock')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('pg_advisory_xact_lock')).toBeLessThan(body.indexOf('FOR UPDATE'));
  });

  it('returns removed automatic penalty allocations to their real receipt', () => {
    const body = bodyOf('private.resync_society_penalties');
    expect(body).toContain("advance_kind = 'PAYMENT'");
    expect(body).toContain('unapplied_amount = unapplied_amount + v_release');
    expect(body).toContain('PAYMENT_CREDIT_CONSERVATION_FAILED');
    expect(body).toContain('PENALTY_CREDIT_SOURCE_AMBIGUOUS');
    expect(body).toContain('private.apply_unit_payment_credit');
  });

  it('keeps historical CMC records while exposing only canonical active AMC configurations', () => {
    expect(sql).toContain("regexp_replace(lc.levy_label, '^CMC-', 'AMC-', 'i')");
    expect(sql).toContain('SET is_active_for_new_collections = false');
    expect(sql).toContain('levy_configs_active_canonical_unique');
    expect(sql).not.toMatch(/UPDATE public\.(amc_collections|levy_assessments)\s+SET levy_label/i);
  });

  it('rejects fractions below one paise at database trust boundaries', () => {
    expect(sql).toContain('resident_payment_claims_whole_paise');
    expect(sql).toContain('private.assert_whole_paise');
    expect(sql).toContain('INVALID_PAISE_AMOUNT');
  });
});

describe('migration 079 AMC-only configuration', () => {
  it('retires non-AMC configuration without rewriting historical financial rows', () => {
    expect(amcOnlySql).toContain("levy_label !~ '^AMC-20[0-9]{2}$'");
    expect(amcOnlySql).toContain('levy_configs_active_amc_year');
    expect(amcOnlySql).not.toMatch(/UPDATE public\.(amc_collections|levy_assessments)/i);
  });
});
