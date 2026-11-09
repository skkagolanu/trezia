import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { deleteImportCsv } from '@/lib/storage/r2';

export const runtime = 'nodejs';

// POST /api/imports/[id]/cancel — abandon an uploaded/validated batch and drop
// its temporary CSV. A committed batch cannot be cancelled.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;
  const { id } = await params;

  const service = await createServiceClient();
  const { data: batch, error: batchError } = await service
    .from('society_import_batches')
    .select('id, object_key, status')
    .eq('id', id)
    .eq('society_id', auth.societyId)
    .maybeSingle();
  if (batchError) return Response.json({ error: 'Could not load the import' }, { status: 500 });
  if (!batch) return Response.json({ error: 'Import not found' }, { status: 404 });

  const { error: cancelError } = await service.rpc('cancel_import_batch', {
    p_batch_id: id,
    p_society_id: auth.societyId,
  });
  if (cancelError) {
    if ((cancelError.message || '').includes('ALREADY_COMMITTED')) {
      return Response.json({ error: 'A committed import cannot be cancelled' }, { status: 409 });
    }
    return Response.json({ error: 'Could not cancel the import' }, { status: 500 });
  }

  try {
    await deleteImportCsv(batch.object_key);
  } catch (error) {
    console.error('[imports] cancel cleanup failed (non-fatal):', error);
  }
  return Response.json({ batch_id: id, status: 'CANCELLED' });
}
