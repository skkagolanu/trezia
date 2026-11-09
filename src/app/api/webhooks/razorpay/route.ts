import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { gatewayEnabled, verifyWebhookSignature, parsePaymentLinkPaid } from '@/lib/payments/razorpay';

// ONLY by HMAC signature — never requireAuth. The proxy excludes /api, so nothing
// rewrites or gates it. This endpoint is the sole source of truth that a bill was
// paid online: the browser "success" redirect is a UX hint and never marks paid.
export const runtime = 'nodejs';
const MAX_WEBHOOK_BYTES = 256 * 1024;

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const length = request.headers.get('content-length');
  if (length !== null) {
    const parsedLength = Number(length);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > MAX_WEBHOOK_BYTES) return null;
  }

  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let value = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      return null;
    }
    value += decoder.decode(chunk.value, { stream: true });
  }
  return value + decoder.decode();
}

export async function POST(request: NextRequest) {
  // Raw bytes exactly as received — signature verification depends on it.
  const rawBody = await readBoundedBody(request);
  if (rawBody === null) return Response.json({ error: 'Payload too large' }, { status: 413 });
  let payload: unknown;
  try { payload = JSON.parse(rawBody); }
  catch { return Response.json({ error: 'Invalid payload' }, { status: 400 }); }

  const event = parsePaymentLinkPaid(payload);
  // Any other verified event (created, cancelled, other webhooks) is acknowledged
  // so Razorpay stops retrying, but is never acted upon.
  if (!event) return Response.json({ received: true }, { status: 200 });

  const supabase = await createServiceClient();
  const { data: link, error: linkError } = await supabase
    .from('resident_payment_links')
    .select('society_id')
    .eq('id', event.referenceId)
    .maybeSingle();
  if (linkError) return Response.json({ error: 'Processing failed' }, { status: 500 });
  if (!link || !gatewayEnabled(link.society_id)) return Response.json({ error: 'Gateway not configured' }, { status: 503 });

  const signature = request.headers.get('x-razorpay-signature');
  if (!verifyWebhookSignature(link.society_id, rawBody, signature)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const { error } = await supabase.rpc('confirm_resident_payment', {
    p_link_id: event.referenceId,
    p_razorpay_payment_id: event.razorpayPaymentId,
    p_method: event.method,
    p_amount_subunits: event.amountPaise,
    p_currency: event.currency,
    p_status: event.status,
    p_razorpay_link_id: event.razorpayLinkId,
  });

  if (error) {
    // 500 so Razorpay retries — the confirm RPC is idempotent, so a retry after a
    // transient failure cannot double-record. Log the code only, never the body.
    console.error(`[razorpay] confirm_resident_payment failed: ${error.code ?? 'unknown'}`);
    return Response.json({ error: 'Processing failed' }, { status: 500 });
  }

  return Response.json({ received: true }, { status: 200 });
}
