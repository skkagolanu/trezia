import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/payments/link/route';
import { requireAuth } from '@/lib/supabase/require-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { check } from '@/lib/utils/rate-limit';
import { createPaymentLink, gatewayEnabled } from '@/lib/payments/razorpay';

jest.mock('@/lib/supabase/require-auth', () => ({ requireAuth: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));
jest.mock('@/lib/utils/rate-limit', () => ({ check: jest.fn(), clientIp: jest.fn(() => '127.0.0.1') }));
jest.mock('@/lib/payments/razorpay', () => ({ createPaymentLink: jest.fn(), gatewayEnabled: jest.fn() }));

function request(amount: number): NextRequest {
  return new Request('http://localhost:3000/api/payments/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ amount }),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue({
    unauthorized: null, role: 'resident', unitId: 'unit-1', societyId: 'society-1',
    societySlug: 'demo-apartments', userId: 'user-1', societyStatus: 'active', isPlatformOwner: false,
  });
  (gatewayEnabled as jest.Mock).mockReturnValue(true);
  (check as jest.Mock).mockReturnValue({ allowed: true, resetAt: Date.now() + 60_000 });
  (createPaymentLink as jest.Mock).mockResolvedValue({
    razorpayLinkId: 'plink_1', shortUrl: 'https://rzp.io/i/abc', status: 'created',
  });
});

it('returns 429 without creating or recording a provider link after the user limit', async () => {
  (check as jest.Mock)
    .mockReturnValueOnce({ allowed: false, resetAt: Date.now() + 60_000 })
    .mockReturnValueOnce({ allowed: true, resetAt: Date.now() + 60_000 });

  const response = await POST(request(15_000));

  expect(response.status).toBe(429);
  expect(createPaymentLink).not.toHaveBeenCalled();
  expect(createServiceClient).not.toHaveBeenCalled();
});

it('accepts an intentional overpayment and records an undirected account link', async () => {
  const insert = jest.fn(async () => ({ data: null, error: null }));
  (createServiceClient as jest.Mock).mockResolvedValue({ from: jest.fn(() => ({ insert })) });

  const response = await POST(request(15_000));

  expect(response.status).toBe(200);
  expect(createPaymentLink).toHaveBeenCalledWith(
    'society-1',
    expect.objectContaining({ amountRupees: 15_000, description: 'Society flat account payment' }),
  );
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({
    society_id: 'society-1',
    unit_id: 'unit-1',
    bill_ids: [],
    amount: 15_000,
    auto_apply_credit: true,
  }));
});

it.each([0, -1, 500_000.01, 100.001])('rejects invalid account amount %s before provider work', async amount => {
  const response = await POST(request(amount));
  expect(response.status).toBe(422);
  expect(createPaymentLink).not.toHaveBeenCalled();
  expect(createServiceClient).not.toHaveBeenCalled();
});

it('rejects operator use of the resident self-service route', async () => {
  (requireAuth as jest.Mock).mockResolvedValue({
    unauthorized: null, role: 'treasurer', unitId: null, societyId: 'society-1',
    societySlug: 'demo-apartments', userId: 'user-1', societyStatus: 'active', isPlatformOwner: false,
  });
  const response = await POST(request(1_000));
  expect(response.status).toBe(403);
  expect(createPaymentLink).not.toHaveBeenCalled();
});
