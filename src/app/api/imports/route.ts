import type { NextRequest } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { MultipartLimitError, parseBoundedMultipart } from '@/lib/uploads/multipart';
import { importCsvKey, uploadImportCsv } from '@/lib/storage/r2';
import { CsvParseError, parseCsv } from '@/lib/imports/csv';
import { isImportStage } from '@/lib/imports/stages';

export const runtime = 'nodejs';

const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_ROWS = 5000;

// POST /api/imports — Admin uploads a stage CSV. Bounded (2 MiB / 5,000 rows),
// stored temporarily in private R2, tracked as an UPLOADED batch. No data is
// written to the society's books here; that happens only at commit.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;

  let parsedMultipart;
  try {
    parsedMultipart = await parseBoundedMultipart(request, { fileField: 'file', maxFileBytes: MAX_CSV_BYTES });
  } catch (error) {
    if (error instanceof MultipartLimitError) {
      return Response.json({ error: 'The file must be a UTF-8 CSV of 2 MiB or less' }, { status: 413 });
    }
    return Response.json({ error: 'Could not read the uploaded file' }, { status: 400 });
  }

  const stage = parsedMultipart.fields.stage;
  if (!isImportStage(stage)) {
    return Response.json({ error: 'Unknown import stage' }, { status: 400 });
  }

  let csvText: string;
  try {
    csvText = new TextDecoder('utf-8', { fatal: true }).decode(parsedMultipart.file.bytes);
  } catch {
    return Response.json({ error: 'The file is not valid UTF-8 text — re-export it as CSV (UTF-8)' }, { status: 422 });
  }

  let parsed;
  try {
    parsed = parseCsv(csvText);
  } catch (error) {
    if (error instanceof CsvParseError) {
      return Response.json({ error: `The CSV is malformed: ${error.message}` }, { status: 422 });
    }
    throw error;
  }
  if (parsed.header.length === 0) {
    return Response.json({ error: 'The CSV has no header row' }, { status: 422 });
  }
  if (parsed.rows.length > MAX_ROWS) {
    return Response.json({ error: `The CSV has ${parsed.rows.length} rows — split it into files of at most ${MAX_ROWS}` }, { status: 422 });
  }

  const batchId = randomUUID();
  const objectKey = importCsvKey(auth.societyId, batchId);
  const sha256 = createHash('sha256').update(parsedMultipart.file.bytes).digest('hex');

  const service = await createServiceClient();
  const { error: rpcError } = await service.rpc('create_import_batch', {
    p_batch_id: batchId,
    p_society_id: auth.societyId,
    p_stage: stage,
    p_object_key: objectKey,
    p_sha256: sha256,
    p_row_count: parsed.rows.length,
    p_created_by: auth.userId,
  });
  if (rpcError) {
    console.error('[imports] create_import_batch failed:', rpcError);
    return Response.json({ error: 'Could not start the import' }, { status: 500 });
  }

  try {
    await uploadImportCsv(objectKey, parsedMultipart.file.bytes);
  } catch (error) {
    console.error('[imports] CSV upload failed:', error);
    await service.rpc('fail_import_batch', { p_batch_id: batchId, p_society_id: auth.societyId, p_reason: 'CSV upload failed' });
    return Response.json({ error: 'Could not store the uploaded file' }, { status: 500 });
  }

  return Response.json({ batch_id: batchId, stage, row_count: parsed.rows.length }, { status: 201 });
}
