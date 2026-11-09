import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { TreasurerHandoverSchema } from '@/lib/validation/schemas';

const HANDOVER_COLUMNS = 'id, society_id, handover_date, outgoing_treasurer, incoming_treasurer, bank_balance, cash_in_hand, outstanding_receivables_note, notes, created_at, updated_at';

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = TreasurerHandoverSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('treasurer_handovers')
    .insert({
      society_id: auth.societyId,
      handover_date: parsed.data.handover_date,
      outgoing_treasurer: parsed.data.outgoing_treasurer,
      incoming_treasurer: parsed.data.incoming_treasurer,
      bank_balance: parsed.data.bank_balance ?? null,
      cash_in_hand: parsed.data.cash_in_hand ?? null,
      outstanding_receivables_note: parsed.data.outstanding_receivables_note ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select(HANDOVER_COLUMNS)
    .single();

  if (error) {
    console.error('[handovers] create failed');
    return Response.json({ error: 'Failed to create handover' }, { status: 500 });
  }

  return Response.json({ data }, { status: 201 });
}
