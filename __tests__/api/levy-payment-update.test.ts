import type { NextRequest } from 'next/server';
import { DELETE, PATCH } from '@/app/api/levies/[id]/route';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { treasurerNameForDate } from '@/lib/treasurer/for-date';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireFinancialOperator: jest.fn() }));
jest.mock('@/lib/treasurer/for-date', () => ({ treasurerNameForDate: jest.fn() }));

const SOCIETY_ID = '11111111-1111-4111-8111-111111111111';
const COLLECTION_ID = '22222222-2222-4222-8222-222222222222';
const params = { params: Promise.resolve({ id: COLLECTION_ID }) };

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialOperator as jest.Mock).mockResolvedValue({
    unauthorized: null, societyId: SOCIETY_ID, userId: 'operator-1',
  });
  (treasurerNameForDate as jest.Mock).mockResolvedValue('Treasurer Name');
});

it('updates a levy collection through the balance-preserving RPC', async () => {
  const rpc = jest.fn(async () => ({ data: { id: COLLECTION_ID, amount_paid: 2500 }, error: null }));
  (createClient as jest.Mock).mockResolvedValue({ rpc });
  const request = new Request(`http://localhost/api/levies/${COLLECTION_ID}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount_paid: 2500, payment_date: '2026-08-20', payment_mode: 'UPI', notes: 'Corrected' }),
  }) as NextRequest;

  const response = await PATCH(request, params);

  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('update_levy_collection_transactional', expect.objectContaining({
    p_society_id: SOCIETY_ID,
    p_collection_id: COLLECTION_ID,
    p_amount_paid: 2500,
    p_recorded_by: 'Treasurer Name',
  }));
});

it('refuses an edit that would exceed the remaining assessment', async () => {
  (createClient as jest.Mock).mockResolvedValue({
    rpc: jest.fn(async () => ({ data: null, error: { message: 'COLLECTION_EXCEEDS_ASSESSMENT' } })),
  });
  const request = new Request(`http://localhost/api/levies/${COLLECTION_ID}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount_paid: 9000 }),
  }) as NextRequest;

  const response = await PATCH(request, params);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'Payment exceeds the outstanding AMC amount' });
});

it('voids a levy collection through the transactional reversal RPC', async () => {
  const rpc = jest.fn(async () => ({ data: { id: COLLECTION_ID }, error: null }));
  (createClient as jest.Mock).mockResolvedValue({ rpc });
  const request = new Request(`http://localhost/api/levies/${COLLECTION_ID}`, {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ void_reason: 'Duplicate levy receipt entered' }),
  }) as NextRequest;

  const response = await DELETE(request, params);

  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('void_levy_collection_transactional', {
    p_society_id: SOCIETY_ID,
    p_collection_id: COLLECTION_ID,
    p_reason: 'Duplicate levy receipt entered',
  });
});
