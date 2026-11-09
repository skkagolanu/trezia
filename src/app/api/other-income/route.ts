import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { OtherIncomeSchema, VoidSchema } from '@/lib/validation/schemas';
import { treasurerNameForDate } from '@/lib/treasurer/for-date';

const PAGE_SIZE = 20;

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

  const parsed = OtherIncomeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const recordedBy = await treasurerNameForDate(supabase, auth.societyId, parsed.data.income_date);
  const { data, error } = await supabase
    .from('other_income')
    .insert({
      income_date:      parsed.data.income_date,
      society_id:       auth.societyId,
      category:         parsed.data.category,
      description:      parsed.data.description,
      amount:           parsed.data.amount,
      received_via:     parsed.data.received_via     ?? null,
      reference_number: parsed.data.reference_number ?? null,
      recorded_by:      recordedBy,
      notes:            parsed.data.notes            ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return Response.json({ error: 'Failed to record income' }, { status: 500 });
  }

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
    .from('other_income')
    .update({ is_voided: true, void_reason: parsed.data.void_reason, voided_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('is_voided', false);

  if (error) {
    console.error(error);
    return Response.json({ error: 'Failed to void income entry' }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  const { searchParams } = request.nextUrl;
  const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const category = searchParams.get('category');
  const from     = searchParams.get('from');
  const to       = searchParams.get('to');
  const from_idx = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  let query = supabase
    .from('other_income')
    .select('*', { count: 'exact' })
    .order('income_date', { ascending: false })
    .range(from_idx, from_idx + PAGE_SIZE - 1);

  if (category) query = query.eq('category', category as never);
  if (from)     query = query.gte('income_date', from);
  if (to)       query = query.lte('income_date', to);

  const { data, count, error } = await query;
  if (error) {
    console.error(error);
    return Response.json({ error: 'Failed to load income entries' }, { status: 500 });
  }

  return Response.json({ data, count, page, pageSize: PAGE_SIZE });
}
