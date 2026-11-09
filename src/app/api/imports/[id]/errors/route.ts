import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { toCsv } from '@/lib/imports/csv';
import type { SocietyImportRecord } from '@/types/database';
import { fetchAll } from '@/lib/supabase/fetch-all';

export const runtime = 'nodejs';

// GET /api/imports/[id]/errors — the row-error CSV a treasurer fixes and
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;
  const { id } = await params;

  const supabase = await createClient();
  const { data: batch, error: batchError } = await supabase
    .from('society_import_batches')
    .select('id, stage')
    .eq('id', id)
    .eq('society_id', auth.societyId)
    .maybeSingle();
  if (batchError) return Response.json({ error: 'Could not load the import' }, { status: 500 });
  if (!batch) return Response.json({ error: 'Import not found' }, { status: 404 });

  let records: Array<Pick<SocietyImportRecord, 'id' | 'row_number' | 'raw' | 'status' | 'errors'>>;
  try {
    records = await fetchAll((from, to) => supabase
      .from('society_import_records')
      .select('id, row_number, raw, status, errors')
      .eq('batch_id', id)
      .eq('status', 'ERROR')
      .order('row_number')
      .order('id')
      .range(from, to));
  } catch {
    return Response.json({ error: 'Could not load the errors' }, { status: 500 });
  }

  const rows = records;
  // Original columns present in the uploaded rows, in stable order.
  const columns = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.raw ?? {})) columns.add(k);
  const dataColumns = [...columns];
  const header = ['row_number', ...dataColumns, 'errors'];
  const csvRows = rows.map(r => [
    String(r.row_number),
    ...dataColumns.map(c => String((r.raw as Record<string, unknown>)?.[c] ?? '')),
    (r.errors ?? []).map(e => `${e.column}: ${e.message}`).join('; '),
  ]);

  return new Response(toCsv(header, csvRows, { neutralizeFormulas: true }), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="import-${batch.stage}-errors.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
