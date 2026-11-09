import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { gatewayEnabled, createPaymentLink } from '@/lib/payments/razorpay';
import { check, clientIp } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

const PaymentLinkRequestSchema = z.object({
  amount: z.number()
    .positive()
    .max(500_000)
    .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, 'Use at most two decimal places'),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.unauthorized) return auth.unauthorized;

  if (!gatewayEnabled(auth.societyId)) {
    return Response.json({ error: 'Online payment is not available' }, { status: 503 });
  }

  // Resident self-service action only — operators record payments through
  // their own write path (TopNav drawer forms), not this route.
  if (auth.role !== 'resident' || !auth.unitId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PaymentLinkRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed' }, { status: 422 });
  }

  // An online payment is intentionally undirected. The signed webhook records
  // one flat-account receipt, then migration 073 allocates it across the oldest
  // maintenance or levy obligations. This also permits a deliberate overpayment
  // without trusting the browser to name or value any financial rows.
  const amount = parsed.data.amount;

  const referenceId = crypto.randomUUID();
  const origin = new URL(request.url).origin;
  const callbackUrl = auth.societySlug
    ? `${origin}/s/${auth.societySlug}/my-flat?paid=1`
    : `${origin}/my-flat?paid=1`;

  const userLimit = check(`payment-link:${auth.societyId}:${auth.userId}`, 5, 60_000);
  const ipLimit = check(`payment-link:ip:${clientIp(request.headers)}`, 15, 60_000);
  if (!userLimit.allowed || !ipLimit.allowed) {
    const resetAt = Math.max(userLimit.resetAt, ipLimit.resetAt);
    return Response.json({ error: 'Too many payment attempts. Please wait and try again.' }, {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) },
    });
  }

  let link;
  try {
    link = await createPaymentLink(auth.societyId, {
      referenceId,
      amountRupees: amount,
      description: 'Society flat account payment',
      callbackUrl,
    });
  } catch {
    console.error('[payments/link] create failed');
    return Response.json({ error: 'Could not start the payment. Please try again.' }, { status: 502 });
  }

  // Service client — residents have no insert policy on this table by design.
  const service = await createServiceClient();
  const { error: insertError } = await service.from('resident_payment_links').insert({
    id: referenceId,
    society_id: auth.societyId,
    unit_id: auth.unitId,
    bill_ids: [],
    amount,
    auto_apply_credit: true,
    razorpay_link_id: link.razorpayLinkId,
    short_url: link.shortUrl,
    status: 'created',
    created_by: auth.userId,
  });

  if (insertError) {
    // The link exists at Razorpay but wasn't recorded here; the webhook keys
    // on referenceId so it would fail to map. Acceptable failure — the
    // resident simply retries and gets a fresh link.
    console.error('[payments/link] record failed');
    return Response.json({ error: 'Could not start the payment. Please try again.' }, { status: 500 });
  }

  return Response.json({ short_url: link.shortUrl }, { status: 200 });
}
