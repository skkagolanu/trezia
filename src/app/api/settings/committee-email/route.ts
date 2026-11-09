import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { CommitteeEmailSchema } from '@/lib/validation/schemas';
import { computeLeanBalanceSummary } from '@/lib/reports/balance-summary';
import { sendCommitteeSummaryEmail } from '@/lib/email/resend';
import { lastMonthRange } from '@/lib/utils/period';
import { check } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

// Treasurer-triggered, always summarises the previous
// calendar month — no scheduler involved, so it doesn't need a third Vercel
// at send time rather than stored (no distribution-list table exists yet).
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;

  // Resend's free tier is 100 emails/day — a defensive cap so a mis-click
  // doesn't burn it (recipients list is capped at 20/send by the schema too).
  const rate = check(`committee-email:${auth.societyId}:${auth.userId}`, 5, 60 * 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many emails sent recently — please wait before trying again.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CommitteeEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const { data: config } = await supabase
    .from('society_config')
    .select('name, mobile')
    .eq('society_id', auth.societyId)
    .single();

  const { from, to } = lastMonthRange();
  const summary = await computeLeanBalanceSummary(from, to);
  const periodLabel = new Date(from + 'T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  try {
    await sendCommitteeSummaryEmail({
      to: parsed.data.to,
      societyName: config?.name ?? 'Your Society',
      periodLabel,
      opening: summary.opening,
      receipts: summary.receipts,
      payments: summary.payments,
      net: summary.net,
      closing: summary.closing,
      treasurerMobile: config?.mobile ?? null,
    });
  } catch (err) {
    console.error('[committee-email] send failed:', err);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, periodLabel, sentTo: parsed.data.to.length });
}
