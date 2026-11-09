import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator, requireFinancialReader } from '@/lib/supabase/require-auth';
import { FundLedgerEntrySchema, VoidSchema } from '@/lib/validation/schemas';

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body === 'object' && body !== null && 'amount' in body) {
    (body as Record<string, unknown>).amount = Number((body as Record<string, unknown>).amount);
  }

  const parsed = FundLedgerEntrySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  // A manual entry (interest credited, a correction) has no source row —
  // source_table/source_id stay NULL, distinguishing it from a
  // payments/expenditures-backed entry recorded through those flows.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('fund_ledger_entries')
    .insert({
      society_id: auth.societyId,
      fund_type:  parsed.data.fund_type,
      entry_type: parsed.data.entry_type,
      amount:     parsed.data.amount,
      entry_date: parsed.data.entry_date,
      notes:      parsed.data.notes ?? null,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = VoidSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('fund_ledger_entries')
    .update({ is_voided: true, void_reason: parsed.data.void_reason, voided_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('is_voided', false);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const { searchParams } = request.nextUrl;
  const fundType = searchParams.get('fund_type');

  const supabase = await createClient();
  let query = supabase
    .from('fund_ledger_entries')
    .select('*')
    .eq('is_voided', false)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (fundType === 'CORPUS' || fundType === 'SINKING') query = query.eq('fund_type', fundType);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ data });
}
