import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { deleteImportCsv, readImportCsv } from '@/lib/storage/r2';
import { isImportStage, STAGE_DEFS } from '@/lib/imports/stages';
import { classifyImport, hashImportPayload } from '@/lib/imports/service';
import { CsvParseError } from '@/lib/imports/csv';
import { createSnapshot } from '@/lib/snapshots/create';

export const runtime = 'nodejs';
export const maxDuration = 60;

const FINANCIAL_STAGES = Object.values(STAGE_DEFS).filter(d => d.financial).map(d => d.stage);

// A human message for the RPC's structured error codes.
function commitErrorMessage(code: string): string {
  if (code.startsWith('UNRESOLVED_FLAT:')) return `No flat "${code.split(':')[1]}" exists — import Flats first`;
  if (code.startsWith('INVOICE_EXISTS:')) return `Invoice "${code.split(':')[1]}" already exists`;
  if (code.startsWith('RECEIPT_EXISTS:')) return `Receipt "${code.split(':')[1]}" already exists`;
  if (code.startsWith('OPENING_BALANCE_EXISTS:')) return `An opening balance for FY ${code.split(':')[1]} already exists`;
  if (code.startsWith('UNRESOLVED_ALLOCATION_BILLS:')) return 'One or more allocated invoice numbers do not exist for this flat';
  if (code === 'PAYMENT_AMOUNT_MISMATCH') return 'An allocated payment does not equal the exact payable total of its bills';
  if (code === 'BILL_NOT_PAYABLE') return 'An allocated bill is already paid or not payable';
  if (code === 'UNALLOCATED_NOT_ACKNOWLEDGED') return 'A payment has no allocation — mark it unallocated=true to record it';
  if (code === 'BATCH_NOT_COMMITTABLE') return 'This import must be validated before it can be committed';
  return 'The import could not be committed — no rows were changed';
}

// POST /api/imports/[id]/commit — apply the validated rows in ONE transaction.
// Any bad row rolls the whole stage back. The first financial stage for a
// society creates a pre-import snapshot first. Imported records are void-only;
// there is no destructive rollback.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;
  const { id } = await params;

  const service = await createServiceClient();
  const { data: batch, error: batchError } = await service
    .from('society_import_batches')
    .select('id, society_id, stage, status, object_key, valid_count, error_count, validation_summary')
    .eq('id', id)
    .eq('society_id', auth.societyId)
    .maybeSingle();
  if (batchError) return Response.json({ error: 'Could not load the import' }, { status: 500 });
  if (!batch) return Response.json({ error: 'Import not found' }, { status: 404 });
  if (!isImportStage(batch.stage)) return Response.json({ error: 'Unknown import stage' }, { status: 400 });
  if (batch.status === 'COMMITTED') {
    return Response.json({ error: 'This import was already committed' }, { status: 409 });
  }
  if (batch.status !== 'VALIDATED') {
    return Response.json({ error: 'Validate the import before committing it' }, { status: 409 });
  }

  let csvText: string;
  let csvBytes: Uint8Array;
  try {
    csvBytes = await readImportCsv(batch.object_key);
  } catch (error) {
    console.error('[imports] read CSV failed:', error);
    return Response.json({ error: 'Could not read the uploaded file' }, { status: 500 });
  }
  try {
    csvText = new TextDecoder('utf-8', { fatal: true }).decode(csvBytes);
  } catch {
    return Response.json({ error: 'The file is not valid UTF-8 text — re-export it as CSV (UTF-8)' }, { status: 422 });
  }

  let classification: Awaited<ReturnType<typeof classifyImport>>;
  try {
    classification = await classifyImport(service, auth.societyId, batch.stage, csvText);
  } catch (error) {
    if (error instanceof CsvParseError) {
      return Response.json({ error: `The CSV is malformed: ${error.message}` }, { status: 422 });
    }
    throw error;
  }
  if (classification.headerErrors.length > 0 || classification.errorCount > 0 || classification.committable.length === 0) {
    return Response.json({ error: 'Every row must be valid before this stage can be imported — fix the errors and re-validate' }, { status: 422 });
  }
  const savedHash = (batch.validation_summary as Record<string, unknown> | null)?.payload_sha256;
  if (batch.error_count !== 0
      || batch.valid_count !== classification.committable.length
      || typeof savedHash !== 'string'
      || savedHash !== hashImportPayload(classification.committable)) {
    return Response.json({ error: 'The validated import no longer matches this file — validate it again' }, { status: 409 });
  }

  // Pre-import snapshot before the first financial stage this society commits, so
  // the books can be restored to their pre-import state if needed.
  if (FINANCIAL_STAGES.includes(batch.stage)) {
    const { data: priorFinancial } = await service
      .from('society_import_batches')
      .select('id')
      .eq('society_id', auth.societyId)
      .eq('status', 'COMMITTED')
      .in('stage', FINANCIAL_STAGES)
      .limit(1)
      .maybeSingle();
    if (!priorFinancial) {
      try {
        await createSnapshot(auth.societyId);
      } catch (error) {
        console.error('[imports] pre-import snapshot failed:', error);
        return Response.json({ error: 'Could not create the safety backup before importing — try again' }, { status: 500 });
      }
    }
  }

  const { data: result, error: commitError } = await service.rpc('commit_import_stage', {
    p_batch_id: id,
    p_society_id: auth.societyId,
    p_actor: auth.userId,
    p_rows: classification.committable,
  });
  if (commitError) {
    const code = commitError.message || 'COMMIT_FAILED';
    await service.rpc('fail_import_batch', { p_batch_id: id, p_society_id: auth.societyId, p_reason: code });
    return Response.json({ error: commitErrorMessage(code) }, { status: 422 });
  }

  // Successful commit deletes the temporary CSV.
  try {
    await deleteImportCsv(batch.object_key);
  } catch (error) {
    console.error('[imports] temp CSV cleanup failed (non-fatal):', error);
  }

  const committed = (result as { committed?: number } | null)?.committed ?? 0;
  const skipped = (result as { skipped?: number } | null)?.skipped ?? 0;
  return Response.json({ batch_id: id, stage: batch.stage, committed, skipped });
}
