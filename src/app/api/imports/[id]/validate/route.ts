import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { readImportCsv } from '@/lib/storage/r2';
import { isImportStage } from '@/lib/imports/stages';
import { classifyImport, hashImportPayload, persistableRecords, validationSummary } from '@/lib/imports/service';
import { CsvParseError } from '@/lib/imports/csv';

export const runtime = 'nodejs';

// POST /api/imports/[id]/validate — dry run. Reads the stored CSV, resolves
// natural keys and existing identifiers against live data, and records the
// preview totals + duplicate/error classification. Writes nothing to the books.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;
  const { id } = await params;

  const service = await createServiceClient();
  const { data: batch, error: batchError } = await service
    .from('society_import_batches')
    .select('id, society_id, stage, status, object_key')
    .eq('id', id)
    .eq('society_id', auth.societyId)
    .maybeSingle();
  if (batchError) return Response.json({ error: 'Could not load the import' }, { status: 500 });
  if (!batch) return Response.json({ error: 'Import not found' }, { status: 404 });
  if (!isImportStage(batch.stage)) return Response.json({ error: 'Unknown import stage' }, { status: 400 });
  if (batch.status !== 'UPLOADED' && batch.status !== 'VALIDATED') {
    return Response.json({ error: `This import is ${batch.status.toLowerCase()} and cannot be re-validated` }, { status: 409 });
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
  const summary = {
    ...validationSummary(classification),
    payload_sha256: hashImportPayload(classification.committable),
  };

  const { error: recordError } = await service.rpc('record_import_validation', {
    p_batch_id: id,
    p_society_id: auth.societyId,
    p_valid_count: classification.validCount,
    p_error_count: classification.errorCount,
    p_summary: summary,
    p_records: persistableRecords(classification),
    p_rows: classification.committable,
  });
  if (recordError) {
    console.error('[imports] record_import_validation failed:', recordError);
    return Response.json({ error: 'Could not save the validation result' }, { status: 500 });
  }

  return Response.json({
    batch_id: id,
    ...summary,
    committable: classification.validCount,
    can_commit: classification.validCount > 0
      && classification.errorCount === 0
      && classification.headerErrors.length === 0,
  });
}
