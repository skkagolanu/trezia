import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/054_handover_integrity.sql'),
  'utf8',
);

describe('treasurer handover release-assurance migration', () => {
  it('adds maintained edit timestamps and append-only audit coverage', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()');
    expect(sql).toContain('BEFORE UPDATE ON public.treasurer_handovers');
    expect(sql).toContain('EXECUTE FUNCTION public.update_updated_at()');
    expect(sql).toContain('AFTER INSERT OR UPDATE ON public.treasurer_handovers');
    expect(sql).toContain('EXECUTE FUNCTION public.log_audit_event()');
  });

  it('retains tenant-scoped insert and update without a delete policy', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS treasurer_handovers_membership_write');
    expect(sql).toContain('FOR INSERT TO authenticated');
    expect(sql).toContain('FOR UPDATE TO authenticated');
    expect(sql).toContain('private.auth_society_finance(society_id)');
    expect(sql).not.toMatch(/FOR DELETE/i);
    expect(sql).not.toMatch(/FOR ALL/i);
  });

  it('blocks hard deletes even for actors that bypass RLS', () => {
    expect(sql).toContain('BEFORE DELETE ON public.treasurer_handovers');
    expect(sql).toContain('EXECUTE FUNCTION public.prevent_hard_delete()');
  });
});
