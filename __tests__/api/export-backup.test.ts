import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/export/route';
import { createClient } from '@/lib/supabase/server';
import { requireBackupManager, requireFinancialReader } from '@/lib/supabase/require-auth';
import { buildBackupSnapshot } from '@/lib/snapshots/create';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireBackupManager: jest.fn(), requireFinancialReader: jest.fn() }));
jest.mock('@/lib/snapshots/create', () => ({ buildBackupSnapshot: jest.fn() }));

const request = new Request('http://localhost/api/export?type=backup') as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  (createClient as jest.Mock).mockResolvedValue({});
});

it('requires backup-manager authority before assembling the service-role backup', async () => {
  (requireBackupManager as jest.Mock).mockResolvedValue({ unauthorized: Response.json({ error: 'Forbidden' }, { status: 403 }) });
  const response = await GET(request);
  expect(response.status).toBe(403);
  expect(requireFinancialReader).not.toHaveBeenCalled();
  expect(buildBackupSnapshot).not.toHaveBeenCalled();
});

it('returns the complete manifest only to an authorized backup manager', async () => {
  (requireBackupManager as jest.Mock).mockResolvedValue({ userId: 'admin', role: 'admin', societyId: 'society-1', unauthorized: null });
  (buildBackupSnapshot as jest.Mock).mockResolvedValue({
    manifest: { artifact_delivery: { mode: 'AUTHENTICATED_BATCH_DOWNLOAD' } },
    object_inventory: [{ storage: 'PRIVATE_ARTIFACTS', key: 'claims/society-1/proof.png' }],
  });
  const response = await GET(request);
  expect(response.status).toBe(200);
  expect(buildBackupSnapshot).toHaveBeenCalledWith('society-1', { includeAttachmentInventory: true });
  expect(await response.json()).toEqual({
    manifest: { artifact_delivery: { mode: 'AUTHENTICATED_BATCH_DOWNLOAD' } },
    object_inventory: [{ storage: 'PRIVATE_ARTIFACTS', key: 'claims/society-1/proof.png' }],
  });
});
