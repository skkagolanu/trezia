import type { NextRequest } from 'next/server';
import { PATCH as patchFinancial } from '@/app/api/settings/financial/route';
import { PATCH as patchUnitAmount } from '@/app/api/units/monthly-amount/route';
import { POST as reconcileLegacy } from '@/app/api/advance-settlements/reconcile/route';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator, requireFinancialSetupManager } from '@/lib/supabase/require-auth';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({
  requireFinancialOperator: jest.fn(),
  requireFinancialSetupManager: jest.fn(),
}));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const AUTH = { userId: 'operator-1', societyId: SOCIETY_ID, unauthorized: null };
const UNIT_ID = '11111111-1111-4111-8111-111111111111';
const SETTLEMENT_ID = '22222222-2222-4222-8222-222222222222';
const BILL_ID = '33333333-3333-4333-8333-333333333333';

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/test', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialSetupManager as jest.Mock).mockResolvedValue(AUTH);
  (requireFinancialOperator as jest.Mock).mockResolvedValue(AUTH);
});

it('sends only validated financial fields to the narrow RPC', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { id: 'config-1' }, error: null });
  (createClient as jest.Mock).mockResolvedValue({ rpc });
  const response = await patchFinancial(request({
    monthly_maintenance_amount: '2500', maintenance_payment_window_days: '7', penalty_rate_percent: '2',
    bank_name: 'Bank', bank_account_no: '123', bank_ifsc: 'ABCD0001', upi_id: 'society@upi',
    dues_notice_title: 'Maintenance due', dues_notice_payby_days: '5', dues_notice_footer: 'Please pay.',
    name: 'A forged legal-name change',
  }));
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('update_financial_setup', expect.objectContaining({
    p_society_id: SOCIETY_ID, p_monthly_maintenance_amount: 2500, p_bank_name: 'Bank',
  }));
  expect(rpc.mock.calls[0][1]).not.toHaveProperty('name');
});

it('rejects an invalid amount before the flat-amount RPC is called', async () => {
  const rpc = jest.fn();
  (createClient as jest.Mock).mockResolvedValue({ rpc });
  const response = await patchUnitAmount(request({ unit_id: UNIT_ID, monthly_amount: -1 }));
  expect(response.status).toBe(422);
  expect(rpc).not.toHaveBeenCalled();
});

it('calls the amount-only flat RPC with the authenticated society', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { id: UNIT_ID }, error: null });
  (createClient as jest.Mock).mockResolvedValue({ rpc });
  const response = await patchUnitAmount(request({ unit_id: UNIT_ID, monthly_amount: '3100' }));
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('update_unit_monthly_amount', {
    p_society_id: SOCIETY_ID, p_unit_id: UNIT_ID, p_monthly_amount: 3100,
  });
});

it('requires exactly one legacy reconciliation resolution', async () => {
  const rpc = jest.fn();
  (createClient as jest.Mock).mockResolvedValue({ rpc });
  const response = await reconcileLegacy(request({
    settlement_id: SETTLEMENT_ID, bill_id: BILL_ID, historical_note: 'Both were supplied',
  }));
  expect(response.status).toBe(422);
  expect(rpc).not.toHaveBeenCalled();
});

it('maps an already-resolved legacy settlement to a conflict', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'SETTLEMENT_NOT_RECONCILABLE' } });
  (createClient as jest.Mock).mockResolvedValue({ rpc });
  const response = await reconcileLegacy(request({ settlement_id: SETTLEMENT_ID, bill_id: BILL_ID }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'This legacy settlement has already been resolved or is no longer eligible' });
});
