import type { NextRequest } from 'next/server';
import { POST as approveClaim } from '@/app/api/payments/claim/[id]/approve/route';
import { createServiceClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { notifyUser } from '@/lib/notifications/notify';

jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireFinancialOperator: jest.fn() }));
jest.mock('@/lib/notifications/notify', () => ({ notifyUser: jest.fn() }));

const CLAIM_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const ASSESSMENT_ID = 'b1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const OPERATOR_ID = 'd1b2c3d4-e5f6-4890-abcd-ef1234567890';

function request(body: unknown = {}): NextRequest {
  return new Request('http://localhost/api/payments/claim/id/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function serviceFor(rpcResult: { data: unknown; error: { message: string } | null }) {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.maybeSingle = jest.fn(async () => ({
    data: {
      submitted_by: 'resident-1',
      society_id: SOCIETY_ID,
      levy_assessment_ids: [ASSESSMENT_ID],
      societies: { slug: 'test-society' },
    },
    error: null,
  }));
  return {
    from: jest.fn(() => query),
    rpc: jest.fn(async () => rpcResult),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialOperator as jest.Mock).mockResolvedValue({
    userId: OPERATOR_ID,
    role: 'treasurer',
    societyId: SOCIETY_ID,
    unauthorized: null,
  });
  (notifyUser as jest.Mock).mockResolvedValue(undefined);
});

describe('POST /api/payments/claim/[id]/approve levy claims', () => {
  it('dispatches a levy claim to its levy RPC', async () => {
    const service = serviceFor({ data: 'collection-1', error: null });
    (createServiceClient as jest.Mock).mockResolvedValue(service);

    const response = await approveClaim(request(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ payment_id: 'collection-1' });
    expect(service.rpc).toHaveBeenCalledWith('approve_resident_levy_claim', {
      p_claim_id: CLAIM_ID,
      p_reviewer_id: OPERATOR_ID,
      p_method: 'upi',
    });
  });

  it.each([
    ['ASSESSMENT_NOT_PAYABLE', 409, 'One or more AMC dues can no longer be approved'],
    ['LEVY_ALREADY_SETTLED', 409, 'One or more AMC dues can no longer be approved'],
    ['COLLECTION_EXCEEDS_ASSESSMENT', 409, 'One or more AMC dues can no longer be approved'],
    ['NOT_A_LEVY_CLAIM', 422, 'This submission does not name an AMC due'],
    ['PAYMENT_AMOUNT_MISMATCH', 422, 'Claimed amount no longer matches the selected AMC dues'],
  ])('maps %s to %i for levy claims', async (message, status, expectedError) => {
    const service = serviceFor({ data: null, error: { message } });
    (createServiceClient as jest.Mock).mockResolvedValue(service);

    const response = await approveClaim(request(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: expectedError });
    expect(notifyUser).not.toHaveBeenCalled();
  });
});
