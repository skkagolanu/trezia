import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/053_society_notices.sql'),
  'utf8',
);
const memberships = readFileSync(
  join(process.cwd(), 'supabase/migrations/045_multi_society_memberships.sql'),
  'utf8',
);

describe('society notices migration', () => {
  it('creates an additive, tenant-owned notice record with lifecycle constraints', () => {
    expect(sql).toContain('CREATE TABLE public.society_notices');
    expect(sql).toContain('id uuid PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(sql).toContain('society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT');
    expect(sql).toContain('created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT');
    expect(sql).toContain('published_at timestamptz NOT NULL DEFAULT now()');
    expect(sql).toContain('expires_at timestamptz');
    expect(sql).toContain('archived_at timestamptz');
    expect(sql).toContain('created_at timestamptz NOT NULL DEFAULT now()');
    expect(sql).toContain('updated_at timestamptz NOT NULL DEFAULT now()');
    expect(sql).toContain('society_notices_expiry_after_publication');
    expect(sql).toContain('expires_at IS NULL OR expires_at > published_at');
    expect(sql).toContain('CREATE INDEX society_notices_society_published_idx');
    expect(sql).toContain('CREATE INDEX society_notices_resident_feed_idx');
    expect(sql).toContain('BEFORE UPDATE ON public.society_notices');
    expect(sql).toContain('EXECUTE FUNCTION public.update_updated_at()');
  });

  it('uses RLS and the existing active, request-scoped membership helpers', () => {
    expect(sql).toContain('ALTER TABLE public.society_notices ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('private.auth_society_finance(society_id)');
    expect(sql).toContain('private.auth_membership_role(society_id) = \'resident\'');
    expect(sql).toContain('private.auth_platform_suspended_read(society_id)');
    expect(memberships).toContain("m.status = 'active' AND s.status = 'active'");
    expect(memberships).toContain("current_setting('request.headers', true)");
  });

  it('keeps resident access read-only and restricted to current published notices', () => {
    expect(sql).toContain('CREATE POLICY society_notices_resident_select');
    expect(sql).toContain('published_at <= now()');
    expect(sql).toContain('archived_at IS NULL');
    expect(sql).toContain('(expires_at IS NULL OR expires_at > now())');
    expect(sql).not.toContain('society_notices_resident_insert');
    expect(sql).not.toContain('society_notices_resident_update');
    expect(sql).not.toContain('society_notices_resident_delete');
    expect(sql).not.toMatch(/CREATE POLICY[^;]+society_notices[^;]+FOR DELETE/i);
    expect(sql).not.toMatch(/acknowledg/i);
  });

  it('allows only finance operators to create or update and does not define deletes', () => {
    expect(sql).toContain('CREATE POLICY society_notices_operator_insert');
    expect(sql).toContain('CREATE POLICY society_notices_operator_update');
    expect(sql).toContain('created_by = (SELECT auth.uid())');
    expect(sql).toContain('WITH CHECK (private.auth_society_finance(society_id))');
    expect(sql).not.toMatch(/FOR ALL/i);
    expect(sql).not.toMatch(/FOR DELETE/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
