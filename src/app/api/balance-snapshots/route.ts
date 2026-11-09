import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator, requireFinancialReader } from '@/lib/supabase/require-auth';
import { BalanceSnapshotSchema } from '@/lib/validation/schemas';

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if ('bank_balance' in b) b.bank_balance = Number(b.bank_balance);
    if ('cash_in_hand' in b) b.cash_in_hand = Number(b.cash_in_hand);
  }

  const parsed = BalanceSnapshotSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('balance_snapshots')
    .insert({
      society_id:   auth.societyId,
      snapshot_date: parsed.data.snapshot_date,
      bank_balance:  parsed.data.bank_balance,
      cash_in_hand:  parsed.data.cash_in_hand,
      notes:         parsed.data.notes ?? null,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ data }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const { searchParams } = request.nextUrl;
  const limit  = Math.min(Number(searchParams.get('limit') ?? 50), 100);
  const offset = Number(searchParams.get('offset') ?? 0);

  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from('balance_snapshots')
    .select('*', { count: 'exact' })
    .order('snapshot_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ data, count, limit, offset });
}
