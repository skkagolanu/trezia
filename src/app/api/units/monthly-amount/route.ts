import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialSetupManager } from '@/lib/supabase/require-auth';
import { UnitMonthlyAmountSchema } from '@/lib/validation/schemas';

export async function PATCH(request: NextRequest) {
  const auth = await requireFinancialSetupManager();
  if (auth.unauthorized) return auth.unauthorized;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (typeof body === 'object' && body !== null && 'monthly_amount' in body) {
    const row = body as Record<string, unknown>;
    row.monthly_amount = row.monthly_amount === null || row.monthly_amount === '' ? null : Number(row.monthly_amount);
  }
  const parsed = UnitMonthlyAmountSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid monthly amount', issues: parsed.error.issues }, { status: 422 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('update_unit_monthly_amount', {
    p_society_id: auth.societyId,
    p_unit_id: parsed.data.unit_id,
    p_monthly_amount: parsed.data.monthly_amount,
  });
  if (error) {
    if (error.message.includes('UNIT_NOT_FOUND')) return Response.json({ error: 'Flat not found in this society' }, { status: 404 });
    if (error.message.includes('INVALID_MONTHLY_AMOUNT')) return Response.json({ error: 'Enter a valid monthly amount' }, { status: 422 });
    return Response.json({ error: 'The monthly amount was not changed. Refresh before trying again.' }, { status: 500 });
  }
  return Response.json({ data });
}
