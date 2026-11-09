import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator, requireFinancialReader } from '@/lib/supabase/require-auth';
import { BankStatementUploadSchema } from '@/lib/validation/schemas';
import { parseBankStatementCsv } from '@/lib/utils/bank-reconciliation';

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BankStatementUploadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const { rows, skippedLines } = parseBankStatementCsv(parsed.data.csv_text);
  if (rows.length === 0) {
    return Response.json({ error: 'No parseable rows found in this CSV — check the Date/Description/Amount columns' }, { status: 422 });
  }

  const dates = rows.map(r => r.date).sort();
  const supabase = await createClient();

  const { data: batch, error } = await supabase.rpc('create_bank_statement_batch', {
    p_society_id: auth.societyId,
    p_filename: parsed.data.filename ?? null,
    p_statement_from: dates[0],
    p_statement_to: dates[dates.length - 1],
    p_lines: rows.map(row => ({
      line_date: row.date,
      description: row.description,
      amount: row.amount,
      reference: null,
    })),
  });

  if (error?.message === 'INVALID_BANK_STATEMENT_IMPORT') {
    console.error('[bank-statement] invalid transactional import');
    return Response.json({ error: 'Bank statement import is invalid' }, { status: 422 });
  }

  if (error || !batch) {
    console.error('[bank-statement] transactional import failed');
    return Response.json({ error: 'Failed to import bank statement' }, { status: 500 });
  }

  return Response.json({ data: batch, parsed: rows.length, skippedLines }, { status: 201 });
}

export async function GET() {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bank_statement_batches')
    .select('*')
    .eq('society_id', auth.societyId)
    .order('uploaded_at', { ascending: false });

  if (error) {
    console.error(error);
    return Response.json({ error: 'Failed to load bank statement batches' }, { status: 500 });
  }

  return Response.json({ data });
}
