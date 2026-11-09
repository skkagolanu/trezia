import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { ExpenseSchema, VoidSchema } from '@/lib/validation/schemas';
import { treasurerNameForDate } from '@/lib/treasurer/for-date';
import type { ExpenseCategory } from '@/types/database';

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

  const parsed = ExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const supabase = await createClient();

  const recordedBy = await treasurerNameForDate(supabase, auth.societyId, parsed.data.expense_date);

  const { data, error } = await supabase
    .from('expenditures')
    .insert({
      expense_date:     parsed.data.expense_date,
      society_id:       auth.societyId,
      category:         parsed.data.category,
      description:      parsed.data.description,
      amount:           parsed.data.amount,
      paid_via:         parsed.data.paid_via         ?? null,
      payee_name:       parsed.data.payee_name       ?? null,
      reference_number: parsed.data.reference_number ?? null,
      recorded_by:      recordedBy,
      notes:            parsed.data.notes            ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return Response.json({ error: 'Failed to record expense' }, { status: 500 });
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
    .from('expenditures')
    .update({
      is_voided:   true,
      void_reason: parsed.data.void_reason,
      voided_at:   new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .eq('society_id', auth.societyId)
    .eq('is_voided', false);

  if (error) {
    console.error(error);
    return Response.json({ error: 'Failed to void expense' }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  const url      = request.nextUrl;
  const category = url.searchParams.get('category');
  const year     = url.searchParams.get('year');
  const month    = url.searchParams.get('month');
  const page     = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));

  const from = (page - 1) * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;

  const supabase = await createClient();

  let query = supabase
    .from('expenditures')
    .select('*', { count: 'exact' })
    .order('expense_date', { ascending: false })
    .range(from, to);

  if (category) {
    query = query.eq('category', category as ExpenseCategory);
  }

  if (year && month) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const start  = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end    = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    query = query.gte('expense_date', start).lte('expense_date', end);
  } else if (year) {
    const y = parseInt(year, 10);
    query = query
      .gte('expense_date', `${y}-01-01`)
      .lte('expense_date', `${y}-12-31`);
  }

  const { data, count, error } = await query;

  if (error) {
    console.error(error);
    return Response.json({ error: 'Failed to load expenses' }, { status: 500 });
  }

  return Response.json({
    data,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / PAGE_SIZE),
    },
  });
}
