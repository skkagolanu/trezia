import type { NextRequest } from 'next/server';
import { PATCH, POST } from '@/app/api/advance-settlements/route';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({
  requireFinancialOperator: jest.fn(),
  requireFinancialReader: jest.fn(),
}));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const ADVANCE_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SETTLEMENT_ID = 'b1b2c3d4-e5f6-4890-abcd-ef1234567890';
const validBody = {
  advance_kind: 'PAYMENT',
  advance_id: ADVANCE_ID,
  settled_amount: 1200,
  settled_against: 'July maintenance bill',
  settled_date: '2026-07-19',
  notes: 'Part settlement',
};

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/advance-settlements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialOperator as jest.Mock).mockResolvedValue({
    userId: 'admin-1', societyId: SOCIETY_ID, unauthorized: null,
  });
});

describe('POST /api/advance-settlements', () => {
  it('creates a settlement through the session-client transaction RPC', async () => {
    const settlement = { id: 'settlement-1', society_id: SOCIETY_ID, ...validBody };
    const rpc = jest.fn(async () => ({ data: settlement, error: null }));
    (createClient as jest.Mock).mockResolvedValue({ rpc });

    const response = await POST(request(validBody));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('create_advance_settlement', {
      p_society_id: SOCIETY_ID,
      p_advance_kind: 'PAYMENT',
      p_advance_id: ADVANCE_ID,
      p_settled_amount: 1200,
      p_settled_against: 'July maintenance bill',
      p_settled_date: '2026-07-19',
      p_notes: 'Part settlement',
      p_bill_id: null,
    });
    expect(await response.json()).toEqual({ data: settlement });
  });

  it('passes p_bill_id through to the RPC when a bill is selected (Task 4)', async () => {
    const BILL_ID = 'd1b2c3d4-e5f6-4890-abcd-ef1234567890';
    const settlement = { id: 'settlement-1', society_id: SOCIETY_ID, ...validBody, bill_id: BILL_ID };
    const rpc = jest.fn(async () => ({ data: settlement, error: null }));
    (createClient as jest.Mock).mockResolvedValue({ rpc });

    const response = await POST(request({ ...validBody, bill_id: BILL_ID }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('create_advance_settlement', expect.objectContaining({
      p_bill_id: BILL_ID,
    }));
  });

  it.each([
    ['NOT_AUTHORIZED', 404, 'Advance not found'],
    ['PAYMENT_ADVANCE_NOT_FOUND', 404, 'Payment advance not found'],
    ['EXPENSE_ADVANCE_NOT_FOUND', 404, 'Expense advance not found'],
    ['SETTLEMENT_EXCEEDS_REMAINING', 422, 'Settlement amount exceeds the remaining advance balance'],
    ['BILL_NOT_FOUND', 404, 'Selected bill could not be found'],
    ['BILL_ALREADY_PAID', 409, 'That bill has already been paid in full'],
    ['BILL_NOT_PAYABLE', 422, 'That bill is not currently payable'],
    ['BILL_UNIT_MISMATCH', 422, 'This advance belongs to a different flat than the selected bill'],
    ['SETTLEMENT_EXCEEDS_BILL', 422, 'Settlement amount exceeds what is still owed on the selected bill'],
    ['EXPENSE_ADVANCE_HAS_NO_BILL', 422, 'An expense advance cannot be settled against a bill'],
    ['INVALID_SETTLEMENT', 422, 'Invalid settlement details'],
  ])('maps %s to a safe response', async (message, status, safeMessage) => {
    const rpc = jest.fn(async () => ({ data: null, error: { code: 'P0001', message } }));
    (createClient as jest.Mock).mockResolvedValue({ rpc });

    const response = await POST(request(validBody));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: safeMessage });
  });

  it('does not expose an unknown database error', async () => {
    const databaseError = { code: '42703', message: 'private database detail' };
    const rpc = jest.fn(async () => ({ data: null, error: databaseError }));
    (createClient as jest.Mock).mockResolvedValue({ rpc });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(request(validBody));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to record advance settlement' });
    expect(consoleError).toHaveBeenCalledWith(databaseError);
    consoleError.mockRestore();
  });
});

describe('PATCH /api/advance-settlements', () => {
  function patchRequest(voidReason = 'Duplicate settlement entered') {
    return new Request('http://localhost/api/advance-settlements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: SETTLEMENT_ID, void_reason: voidReason }),
    }) as NextRequest;
  }

  it('uses the reversal RPC instead of voiding only the audit row', async () => {
    const rpc = jest.fn(async () => ({ data: { id: SETTLEMENT_ID, is_voided: true }, error: null }));
    (createClient as jest.Mock).mockResolvedValue({ rpc });

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('void_advance_settlement', {
      p_society_id: SOCIETY_ID,
      p_settlement_id: SETTLEMENT_ID,
      p_reason: 'Duplicate settlement entered',
    });
  });

  it('does not expose an unknown reversal error', async () => {
    const error = { message: 'private balance detail' };
    (createClient as jest.Mock).mockResolvedValue({ rpc: jest.fn(async () => ({ data: null, error })) });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to void advance settlement' });
    expect(consoleError).toHaveBeenCalledWith(error);
    consoleError.mockRestore();
  });
});
