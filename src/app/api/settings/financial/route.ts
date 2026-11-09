import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialSetupManager } from '@/lib/supabase/require-auth';
import { FinancialSetupSchema } from '@/lib/validation/schemas';

export async function PATCH(request: NextRequest) {
  const auth = await requireFinancialSetupManager();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (typeof body === 'object' && body !== null) {
    const row = body as Record<string, unknown>;
    for (const key of ['monthly_maintenance_amount', 'maintenance_payment_window_days', 'penalty_rate_percent', 'dues_notice_payby_days']) {
      if (key in row) row[key] = Number(row[key]);
    }
  }
  const parsed = FinancialSetupSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid financial setup', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const value = parsed.data;
  const { data, error } = await supabase.rpc('update_financial_setup', {
    p_society_id: auth.societyId,
    p_monthly_maintenance_amount: value.monthly_maintenance_amount,
    p_maintenance_payment_window_days: value.maintenance_payment_window_days,
    p_penalty_rate_percent: value.penalty_rate_percent,
    p_bank_name: value.bank_name,
    p_bank_account_no: value.bank_account_no,
    p_bank_ifsc: value.bank_ifsc,
    p_upi_id: value.upi_id,
    p_dues_notice_title: value.dues_notice_title,
    p_dues_notice_payby_days: value.dues_notice_payby_days,
    p_dues_notice_footer: value.dues_notice_footer,
  });
  if (error) {
    const known = error.message.includes('INVALID_FINANCIAL_SETUP') || error.message.includes('SOCIETY_NOT_FOUND');
    return Response.json({ error: known ? 'Financial setup could not be saved. Check the values and try again.' : 'Financial setup was not saved. Refresh before trying again.' }, { status: known ? 422 : 500 });
  }
  return Response.json({ data });
}
