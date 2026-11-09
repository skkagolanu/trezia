import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/055_operating_layer.sql'), 'utf8');

describe('Operating layer migration', () => {
  it.each(['society_documents','vendors','vendor_contracts','assets','asset_service_records','operational_expense_links','society_attachments'])('creates %s with RLS', table => {
    expect(sql).toContain(`CREATE TABLE public.${table}`);
    expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  });

  it('enforces tenant-safe relationships and single-parent records', () => {
    expect(sql).toContain('FOREIGN KEY (vendor_id, society_id)');
    expect(sql).toContain('FOREIGN KEY (expenditure_id, society_id)');
    expect(sql).toContain('attachment_exactly_one_parent');
    expect(sql).toContain('operational_link_exactly_one_parent');
    expect(sql).toContain("object_key = 'attachments/' || society_id::text || '/' || id::text");
  });

  it('keeps residents read-only and limited to published material', () => {
    expect(sql).toContain('list_resident_documents');
    expect(sql).toContain('list_resident_attachments');
    expect(sql).toContain('get_resident_attachment');
    expect(sql).toContain('d.published_to_residents AND d.archived_at IS NULL');
    expect(sql).toContain("audience IN ('ALL_MEMBERS','RESIDENTS')");
    expect(sql).not.toContain('society_attachments_resident_select');
    expect(sql).not.toContain('society_documents_resident_select');
    expect(sql).toContain("SECURITY DEFINER SET search_path = ''");
    expect(sql).toContain('COALESCE(p_limit, 25)');
    expect(sql).toContain('COALESCE(p_offset, 0)');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_resident_attachment(uuid) FROM PUBLIC, anon');
    expect(sql).not.toMatch(/CREATE POLICY .*resident_(insert|update|delete)/i);
  });

  it('has no delete policies and audits lifecycle changes', () => {
    expect(sql).not.toMatch(/FOR DELETE/i);
    expect(sql).toContain('EXECUTE FUNCTION public.prevent_operational_hard_delete()');
    expect(sql).toContain('EXECUTE FUNCTION public.log_audit_event()');
  });
});
