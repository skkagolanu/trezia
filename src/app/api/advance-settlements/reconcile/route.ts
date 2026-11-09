import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { LegacyAdvanceReconciliationSchema } from '@/lib/validation/schemas';

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = LegacyAdvanceReconciliationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({
      error: parsed.error.issues[0]?.message ?? 'Choose how to resolve this legacy settlement',
      issues: parsed.error.issues,
    }, { status: 422 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('reconcile_legacy_advance_settlement', {
    p_society_id: auth.societyId,
    p_settlement_id: parsed.data.settlement_id,
    p_bill_id: parsed.data.bill_id ?? null,
    p_historical_note: parsed.data.historical_note ?? null,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('SETTLEMENT_NOT_RECONCILABLE')) {
      return Response.json({ error: 'This legacy settlement has already been resolved or is no longer eligible' }, { status: 409 });
    }
    if (message.includes('BILL_ALREADY_PAID') || message.includes('BILL_NOT_PAYABLE')) {
      return Response.json({ error: 'The selected bill is already paid' }, { status: 409 });
    }
    if (message.includes('BILL_UNIT_MISMATCH')) {
      return Response.json({ error: 'The selected bill belongs to a different flat' }, { status: 422 });
    }
    if (message.includes('SETTLEMENT_EXCEEDS_BILL')) {
      return Response.json({ error: 'The recorded settlement exceeds the amount still owed on this bill' }, { status: 422 });
    }
    if (message.includes('BILL_NOT_FOUND')) {
      return Response.json({ error: 'The selected bill is no longer eligible' }, { status: 404 });
    }
    if (message.includes('CHOOSE_ONE_RESOLUTION') || message.includes('INVALID_HISTORICAL_NOTE')) {
      return Response.json({ error: 'Choose one bill or provide a historical explanation of at least 10 characters' }, { status: 422 });
    }
    return Response.json({ error: 'The legacy settlement was not reconciled. Refresh before trying again.' }, { status: 500 });
  }

  return Response.json({ data });
}
