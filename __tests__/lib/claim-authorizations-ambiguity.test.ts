import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/057_claim_authorizations_variable_conflict.sql'),
  'utf8',
);

// claim_access_authorizations is declared RETURNS TABLE(app_role, unit_id, society_id),
// so those names are OUT variables for the whole body. A bare `society_id` in the
// membership lookup matches both that variable and a real column, which PostgreSQL
// rejects at runtime ("column reference is ambiguous") the first time an invite is
// actually claimed — breaking first sign-in for every invited user.
describe('claim_access_authorizations column ambiguity', () => {
  // Table-qualifying predicates is NOT sufficient and migration 056 proved it in
  // production: ON CONFLICT (user_id, society_id) and UPDATE SET targets are bare
  // column positions that cannot take a qualifier, yet still get substituted.
  // The function-level directive is the load-bearing fix — assert it directly.
  it('disables variable substitution for column names across the whole body', () => {
    expect(migration).toContain('#variable_conflict use_column');
    expect(migration).toMatch(/AS \$\$\s*\n#variable_conflict use_column\s*\nDECLARE/);
  });

  it('still carries the ON CONFLICT upsert the directive has to protect', () => {
    expect(migration).toContain('ON CONFLICT (user_id, society_id) DO UPDATE SET');
  });

  it('qualifies the membership lookup so society_id cannot bind to the OUT parameter', () => {
    expect(migration).toContain('FROM public.society_memberships m');
    expect(migration).toMatch(/m\.user_id = p_user_id AND m\.society_id = v_invite\.society_id/);
  });

  it('keeps the function service-role only', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.claim_access_authorizations(uuid, text) FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.claim_access_authorizations(uuid, text) TO service_role');
  });

  it('preserves the skip-and-continue contract rather than aborting every claim', () => {
    expect(migration).toContain('CONTINUE;');
    expect(migration).not.toContain("RAISE EXCEPTION 'CONFLICTING_MEMBERSHIP'");
  });
});
