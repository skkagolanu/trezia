import { createHmac } from 'node:crypto';
import { gatewayEnabled, verifyWebhookSignature, parsePaymentLinkPaid } from '@/lib/payments/razorpay';

function setAllCredentials() {
  process.env.RAZORPAY_SOCIETY_ID = 'society-1';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key_id';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_key_secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_test_webhook_secret';
}

function clearAllCredentials() {
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  delete process.env.RAZORPAY_SOCIETY_ID;
  delete process.env.RAZORPAY_SOCIETY_ACCOUNTS_JSON;
}

beforeEach(() => {
  clearAllCredentials();
});

afterEach(() => {
  clearAllCredentials();
});

describe('gatewayEnabled', () => {
  it('is true only when all three credentials are present', () => {
    setAllCredentials();
    expect(gatewayEnabled('society-1')).toBe(true);
  });

  it.each(['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const)(
    'is false when %s is missing',
    key => {
      setAllCredentials();
      delete process.env[key];
      expect(gatewayEnabled('society-1')).toBe(false);
    },
  );

  it('is false when nothing is configured', () => {
    expect(gatewayEnabled('society-1')).toBe(false);
  });
});

describe('verifyWebhookSignature', () => {
  const rawBody = JSON.stringify({ event: 'payment_link.paid', payload: {} });

  it('returns true for a correctly computed HMAC-SHA256 signature', () => {
    setAllCredentials();
    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
      .update(rawBody, 'utf8')
      .digest('hex');

    expect(verifyWebhookSignature('society-1', rawBody, signature)).toBe(true);
  });

  it('returns false for a tampered signature of the same length', () => {
    setAllCredentials();
    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
      .update(rawBody, 'utf8')
      .digest('hex');
    const tampered = signature.slice(0, -1) + (signature.endsWith('a') ? 'b' : 'a');

    expect(verifyWebhookSignature('society-1', rawBody, tampered)).toBe(false);
  });

  it('returns false for a wrong-length signature without throwing', () => {
    setAllCredentials();
    expect(() => verifyWebhookSignature('society-1', rawBody, 'deadbeef')).not.toThrow();
    expect(verifyWebhookSignature('society-1', rawBody, 'deadbeef')).toBe(false);
  });

  it('returns false for a null signature', () => {
    setAllCredentials();
    expect(verifyWebhookSignature('society-1', rawBody, null)).toBe(false);
  });

  it('returns false when no webhook secret is configured', () => {
    const signature = createHmac('sha256', 'irrelevant').update(rawBody, 'utf8').digest('hex');
    expect(verifyWebhookSignature('society-1', rawBody, signature)).toBe(false);
  });
});

describe('parsePaymentLinkPaid', () => {
  function paidPayload(overrides: {
    referenceId?: string;
    paymentId?: string;
    method?: string;
    amount?: number;
    currency?: string;
    status?: string;
  } = {}) {
    return {
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: 'plink_123', reference_id: overrides.referenceId ?? 'link-123', status: 'paid' } },
        payment: {
          entity: {
            id: overrides.paymentId ?? 'pay_abc123',
            amount: overrides.amount ?? 12345,
            currency: overrides.currency ?? 'INR',
            status: overrides.status ?? 'captured',
            ...(overrides.method !== undefined ? { method: overrides.method } : { method: 'upi' }),
          },
        },
      },
    };
  }

  it('extracts referenceId, razorpayPaymentId, and method from a well-formed event', () => {
    expect(parsePaymentLinkPaid(paidPayload())).toEqual({
      referenceId: 'link-123',
      razorpayPaymentId: 'pay_abc123',
      razorpayLinkId: 'plink_123',
      method: 'upi',
      amountPaise: 12345,
      currency: 'INR',
      status: 'captured',
    });
  });

  it('returns null for a different event type', () => {
    const payload = { ...paidPayload(), event: 'payment_link.created' };
    expect(parsePaymentLinkPaid(payload)).toBeNull();
  });

  it('returns null when reference_id is missing', () => {
    const payload = paidPayload();
    delete (payload.payload.payment_link.entity as { reference_id?: string }).reference_id;
    expect(parsePaymentLinkPaid(payload)).toBeNull();
  });

  it('returns null when the payment id is missing', () => {
    const payload = paidPayload();
    delete (payload.payload.payment.entity as { id?: string }).id;
    expect(parsePaymentLinkPaid(payload)).toBeNull();
  });

  it('defaults method to "unknown" when absent', () => {
    const payload = paidPayload();
    delete (payload.payload.payment.entity as { method?: string }).method;
    expect(parsePaymentLinkPaid(payload)).toEqual({
      referenceId: 'link-123',
      razorpayPaymentId: 'pay_abc123',
      razorpayLinkId: 'plink_123',
      method: 'unknown',
      amountPaise: 12345,
      currency: 'INR',
      status: 'captured',
    });
  });

  it('returns null for non-object payloads', () => {
    expect(parsePaymentLinkPaid(null)).toBeNull();
    expect(parsePaymentLinkPaid('not an object')).toBeNull();
  });
});
