import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator, requireFinancialReader } from '@/lib/supabase/require-auth';
import { OpeningBalanceSchema } from '@/lib/validation/schemas';

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
    if ('fy_start_year' in b) b.fy_start_year = Number(b.fy_start_year);
    if ('bank_balance' in b) b.bank_balance = Number(b.bank_balance);
    if ('cash_in_hand' in b) b.cash_in_hand = Number(b.cash_in_hand);
  }

  const parsed = OpeningBalanceSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  // One row per FY (fy_start_year is unique) — recording again for the same
  // FY updates the existing record rather than erroring or duplicating.
  const { data, error } = await supabase
    .from('opening_balances')
    .upsert(
      {
        society_id:   auth.societyId,
        fy_start_year: parsed.data.fy_start_year,
        bank_balance:  parsed.data.bank_balance,
        cash_in_hand:  parsed.data.cash_in_hand,
        notes:         parsed.data.notes ?? null,
        recorded_by:   auth.userId,
        updated_at:    new Date().toISOString(),
      },
      { onConflict: 'society_id,fy_start_year' },
    )
    .select()
    .single();

  if (error) {
    console.error(error);
    return Response.json({ error: 'Failed to record opening balance' }, { status: 500 });
  }

  return Response.json({ data }, { status: 201 });
}

export async function GET() {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('opening_balances')
    .select('*')
    .order('fy_start_year', { ascending: false });

  if (error) {
    console.error(error);
    return Response.json({ error: 'Failed to load opening balances' }, { status: 500 });
  }

  return Response.json({ data });
}
