import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/055_operating_layer.sql'), 'utf8');
const itemRoute = readFileSync(join(process.cwd(), 'src/app/api/attachments/[id]/route.ts'), 'utf8');

describe('resident attachment boundary', () => {
  it('does not grant residents direct table access', () => {
    expect(migration).not.toContain('society_attachments_resident_select');
    expect(migration).not.toContain('society_documents_resident_select');
  });

  it('exposes only a fixed metadata projection from resident RPCs', () => {
    expect(migration).toContain('RETURNS TABLE (id uuid, filename text, content_type text, byte_size integer)');
    expect(migration).toContain("SECURITY DEFINER SET search_path = ''");
    expect(migration).toContain("private.auth_membership_role(a.society_id) = 'resident'");
  });

  it('derives the object key instead of selecting it for download', () => {
    expect(itemRoute).toContain('attachmentKey(societyId, data.id)');
    expect(itemRoute).not.toMatch(/select\([^)]*object_key/);
    expect(itemRoute).toContain("'Cache-Control': 'private, no-store, max-age=0'");
    expect(itemRoute).toContain("'X-Content-Type-Options': 'nosniff'");
  });
});
