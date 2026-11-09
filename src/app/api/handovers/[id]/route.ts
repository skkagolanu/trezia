import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { TreasurerHandoverPatchSchema } from '@/lib/validation/schemas';
import type { TreasurerHandover } from '@/types/database';

const HANDOVER_COLUMNS = 'id, society_id, handover_date, outgoing_treasurer, incoming_treasurer, bank_balance, cash_in_hand, outstanding_receivables_note, notes, created_at, updated_at';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'Handover not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = TreasurerHandoverPatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const update: Partial<Pick<TreasurerHandover,
    | 'handover_date'
    | 'outgoing_treasurer'
    | 'incoming_treasurer'
    | 'bank_balance'
    | 'cash_in_hand'
    | 'outstanding_receivables_note'
    | 'notes'
  >> = { ...parsed.data };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('treasurer_handovers')
    .update(update)
    .eq('id', id)
    .eq('society_id', auth.societyId)
    .select(HANDOVER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error('[handovers] update failed');
    return Response.json({ error: 'Failed to update handover' }, { status: 500 });
  }
  if (!data) return Response.json({ error: 'Handover not found' }, { status: 404 });

  return Response.json({ data });
}
