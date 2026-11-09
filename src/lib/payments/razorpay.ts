import { createHmac, timingSafeEqual } from 'node:crypto';

// Resident online payments use Razorpay Payment Links: the server creates a
// hosted payment link, the resident pays on Razorpay's page (no card data ever
// touches this app), and a signed webhook is the ONLY thing that marks a bill
// paid. Credentials live in env vars, per society deployment — never in the DB,
// never in NEXT_PUBLIC_*. The feature stays dark until all three are set, so the
// app runs identically with or without a Razorpay account configured.
//
// deployment that is the platform env; getPaymentConfig() is the one place to
// extend to per-society credentials later without touching callers.

const RAZORPAY_API = 'https://api.razorpay.com/v1';

export type PaymentConfig = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
};

function validConfig(value: unknown): value is PaymentConfig {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['keyId', 'keySecret', 'webhookSecret'].every(key => typeof row[key] === 'string' && row[key].length > 0);
}

function readConfig(societyId: string): PaymentConfig | null {
  const raw = process.env.RAZORPAY_SOCIETY_ACCOUNTS_JSON;
  if (raw) {
    try {
      const accounts = JSON.parse(raw) as Record<string, unknown>;
      const config = accounts[societyId];
      return validConfig(config) ? config : null;
    } catch {
      console.error('[razorpay] invalid RAZORPAY_SOCIETY_ACCOUNTS_JSON');
      return null;
    }
  }

  if (process.env.RAZORPAY_SOCIETY_ID !== societyId) return null;
  const config = {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  };
  return validConfig(config) ? config : null;
}

// True only when every credential is present. Callers gate the "Pay online"
// surface and the webhook on this — with it false, the free UPI path still works
// and the webhook returns 503 rather than half-processing.
export function gatewayEnabled(societyId: string): boolean {
  return readConfig(societyId) !== null;
}

export function getPaymentConfig(societyId: string): PaymentConfig | null {
  return readConfig(societyId);
}

export type CreatedPaymentLink = {
  razorpayLinkId: string;
  shortUrl: string;
  status: string;
};

export type CreatePaymentLinkInput = {
  // Unique per link, max 40 chars — we pass the resident_payment_links row id so
  // the webhook's payload.payment_link.entity.reference_id maps straight back.
  referenceId: string;
  amountRupees: number;
  description: string;
  callbackUrl: string;
  customer?: { name?: string; email?: string; contact?: string };
};

// Razorpay amounts are in the smallest currency unit (paise). Round to avoid
// floating-point drift landing a bill a paisa short of its payable amount.
function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export async function createPaymentLink(societyId: string, input: CreatePaymentLinkInput): Promise<CreatedPaymentLink> {
  const config = readConfig(societyId);
  if (!config) throw new Error('RAZORPAY_NOT_CONFIGURED');

  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64');
  const body = {
    amount: toPaise(input.amountRupees),
    currency: 'INR',
    reference_id: input.referenceId,
    description: input.description.slice(0, 2048),
    callback_url: input.callbackUrl,
    callback_method: 'get',
    ...(input.customer ? { customer: input.customer } : {}),
    notify: { sms: false, email: false },
    reminder_enable: false,
  };

  const response = await fetch(`${RAZORPAY_API}/payment_links`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Never surface Razorpay's raw error body to the caller — it can echo the
    // request. Log the status only; the route maps this to a generic failure.
    console.error(`[razorpay] create payment link failed: ${response.status}`);
    throw new Error('RAZORPAY_LINK_CREATE_FAILED');
  }

  const data = await response.json() as { id?: string; short_url?: string; status?: string };
  if (!data.id || !data.short_url) throw new Error('RAZORPAY_LINK_CREATE_FAILED');
  return { razorpayLinkId: data.id, shortUrl: data.short_url, status: data.status ?? 'created' };
}

// HMAC-SHA256 over the RAW request body with the webhook secret as key, compared
// in constant time against the X-Razorpay-Signature header. The raw bytes must be
// hashed exactly as received — any JSON re-serialization invalidates the match.
export function verifyWebhookSignature(societyId: string, rawBody: string, signature: string | null): boolean {
  const config = readConfig(societyId);
  if (!config || !signature) return false;

  const expected = createHmac('sha256', config.webhookSecret).update(rawBody, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(signature, 'utf8');
  // timingSafeEqual throws on length mismatch — guard first so a wrong-length
  // forgery is a plain false, not an exception.
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

// Narrow reader for the one event we act on. Everything else is acknowledged and
// ignored so Razorpay does not retry, but never acted upon.
export type PaymentLinkPaidEvent = {
  referenceId: string;
  razorpayLinkId: string;
  razorpayPaymentId: string;
  method: string;
  amountPaise: number;
  currency: string;
  status: string;
};

export function parsePaymentLinkPaid(payload: unknown): PaymentLinkPaidEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const event = payload as {
    event?: string;
    payload?: {
      payment_link?: { entity?: { id?: string; reference_id?: string; status?: string } };
      payment?: { entity?: { id?: string; method?: string; amount?: number; currency?: string; status?: string } };
    };
  };
  if (event.event !== 'payment_link.paid') return null;
  const referenceId = event.payload?.payment_link?.entity?.reference_id;
  const razorpayLinkId = event.payload?.payment_link?.entity?.id;
  const razorpayPaymentId = event.payload?.payment?.entity?.id;
  const amountPaise = event.payload?.payment?.entity?.amount;
  const currency = event.payload?.payment?.entity?.currency;
  const status = event.payload?.payment?.entity?.status;
  const method = event.payload?.payment?.entity?.method ?? 'unknown';
  if (!referenceId || !razorpayLinkId || !razorpayPaymentId || typeof amountPaise !== 'number' || !Number.isSafeInteger(amountPaise) || !currency || status !== 'captured') return null;
  return { referenceId, razorpayLinkId, razorpayPaymentId, method, amountPaise, currency, status };
}
