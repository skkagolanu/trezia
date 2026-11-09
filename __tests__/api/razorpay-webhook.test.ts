import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/webhooks/razorpay/route';
import { createServiceClient } from '@/lib/supabase/server';
import { gatewayEnabled, verifyWebhookSignature, parsePaymentLinkPaid } from '@/lib/payments/razorpay';

jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));
jest.mock('@/lib/payments/razorpay', () => ({
  gatewayEnabled: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  parsePaymentLinkPaid: jest.fn(),
}));

const RAW_BODY = JSON.stringify({ event: 'payment_link.paid', payload: {} });
const PARSED_EVENT = {
  referenceId: 'link-123',
  razorpayLinkId: 'plink_123',
  razorpayPaymentId: 'pay_abc123',
  method: 'upi',
  amountPaise: 200000,
  currency: 'INR',
  status: 'captured',
};

function request(signature: string | null = 'valid-signature'): NextRequest {
  return new Request('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: signature !== null ? { 'x-razorpay-signature': signature } : {},
    body: RAW_BODY,
  }) as unknown as NextRequest;
}

function serviceClientWithRpc(result: { data: unknown; error: { code?: string } | null }) {
  const rpc = jest.fn(async () => result);
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.maybeSingle = jest.fn(async () => ({ data: { society_id: 'society-1' }, error: null }));
  return { rpc, from: jest.fn(() => query) };
}

beforeEach(() => {
  jest.clearAllMocks();
  (parsePaymentLinkPaid as jest.Mock).mockReturnValue(PARSED_EVENT);
  (createServiceClient as jest.Mock).mockResolvedValue(serviceClientWithRpc({ data: null, error: null }));
});

describe('POST /api/webhooks/razorpay', () => {
  it('rejects an oversized declared body before parsing or service access', async () => {
    const oversized = new Request('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST', headers: { 'content-length': String(256 * 1024 + 1) }, body: '{}',
    }) as unknown as NextRequest;

    const response = await POST(oversized);

    expect(response.status).toBe(413);
    expect(parsePaymentLinkPaid).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('rejects a streamed body that exceeds the limit without a content length', async () => {
    const chunk = new Uint8Array(256 * 1024 + 1);
    const oversized = {
      headers: new Headers(),
      body: new ReadableStream({ start(controller) { controller.enqueue(chunk); controller.close(); } }),
    } as unknown as NextRequest;

    const response = await POST(oversized);

    expect(response.status).toBe(413);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without service access', async () => {
    const malformed = new Request('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST', body: '{', headers: { 'x-razorpay-signature': 'signature' },
    }) as unknown as NextRequest;

    const response = await POST(malformed);

    expect(response.status).toBe(400);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
  it('returns 503 and never calls the service client when the gateway is not configured', async () => {
    (gatewayEnabled as jest.Mock).mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it('returns 401 and never calls the service client when the signature is invalid', async () => {
    (gatewayEnabled as jest.Mock).mockReturnValue(true);
    (verifyWebhookSignature as jest.Mock).mockReturnValue(false);

    const response = await POST(request('bad-signature'));

    expect(response.status).toBe(401);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
  });

  it('acknowledges with 200 and never calls the rpc for an unrelated verified event', async () => {
    (parsePaymentLinkPaid as jest.Mock).mockReturnValue(null);
    const client = serviceClientWithRpc({ data: null, error: null });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('calls confirm_resident_payment with the parsed event and returns 200 on success', async () => {
    (gatewayEnabled as jest.Mock).mockReturnValue(true);
    (verifyWebhookSignature as jest.Mock).mockReturnValue(true);
    (parsePaymentLinkPaid as jest.Mock).mockReturnValue(PARSED_EVENT);
    const client = serviceClientWithRpc({ data: null, error: null });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('confirm_resident_payment', {
      p_link_id: PARSED_EVENT.referenceId,
      p_razorpay_link_id: PARSED_EVENT.razorpayLinkId,
      p_razorpay_payment_id: PARSED_EVENT.razorpayPaymentId,
      p_method: PARSED_EVENT.method,
      p_amount_subunits: PARSED_EVENT.amountPaise,
      p_currency: PARSED_EVENT.currency,
      p_status: PARSED_EVENT.status,
    });
  });

  it('returns 500 so Razorpay retries when the rpc errors', async () => {
    (gatewayEnabled as jest.Mock).mockReturnValue(true);
    (verifyWebhookSignature as jest.Mock).mockReturnValue(true);
    (parsePaymentLinkPaid as jest.Mock).mockReturnValue(PARSED_EVENT);
    const client = serviceClientWithRpc({ data: null, error: { code: '23505' } });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Processing failed' });
    consoleError.mockRestore();
  });
});
