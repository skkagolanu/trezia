import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { BankStatementLineActionSchema } from '@/lib/validation/schemas';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string; lineId: string }> },
) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  const { batchId, lineId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BankStatementLineActionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createServiceClient();
  const { error } = await supabase.rpc('reconcile_bank_statement_line', {
    p_society_id: auth.societyId,
    p_batch_id: batchId,
    p_line_id: lineId,
    p_actor_id: auth.userId,
    p_action: parsed.data.action,
    p_matched_table: parsed.data.action === 'match' ? parsed.data.matched_table : null,
    p_matched_id: parsed.data.action === 'match' ? parsed.data.matched_id : null,
  });

  if ((error?.message ?? '').includes('BANK_LINE_NOT_FOUND')) {
    return Response.json({ error: 'Bank statement line not found' }, { status: 404 });
  }
  if ((error?.message ?? '').includes('BANK_MATCH_TARGET_INVALID')) {
    return Response.json({ error: 'That financial record is no longer available for matching' }, { status: 409 });
  }
  if (error?.code === '23505' || (error?.message ?? '').includes('BANK_LINE_NOT_MATCHABLE')) {
    return Response.json({ error: 'That statement line or financial record is already matched' }, { status: 409 });
  }
  if (error) {
    console.error('[bank-statement/line] update failed');
    return Response.json({ error: 'Failed to update bank statement line' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
