import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/payments/route';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { notifyUnitResidents } from '@/lib/notifications/notify';
import { generateAndStoreReceipt } from '@/lib/pdf/generate-and-store-receipt';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({
  requireFinancialOperator: jest.fn(),
  requireFinancialReader: jest.fn(),
}));
jest.mock('@/lib/notifications/notify', () => ({ notifyUnitResidents: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/pdf/generate-and-store-receipt', () => ({
  generateAndStoreReceipt: jest.fn().mockResolvedValue({ pdfUrl: 'https://example.test/receipt.pdf', whatsappUrl: null }),
}));
jest.mock('@/lib/treasurer/for-date', () => ({ treasurerNameForDate: jest.fn().mockResolvedValue('Priya Treasurer') }));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UNIT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const PAYMENT_ID = 'e1b2c3d4-e5f6-7890-abcd-ef1234567890';
const SOCIETY_SLUG = 'green-heights';

const OPERATOR_AUTH = { userId: 'treasurer-1', role: 'treasurer', societyId: SOCIETY_ID, unauthorized: null };

const VALID_PAYMENT = {
  unit_id:        UNIT_ID,
  amount_paid:    2000,
  payment_mode:   'UPI' as const,
  payment_date:   '2026-06-01',
  months_covered: 1,
};

const PAYMENT_ROW = {
  id: PAYMENT_ID,
  receipt_number: 'RCPT-0001',
  amount_paid: 2000,
  payment_mode: 'UPI',
  payment_date: '2026-06-01',
  is_voided: false,
  created_at: '2026-06-01T09:00:00.000Z',
};

function paymentRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

// existing-payments page (no month overlap), the paying unit's society_id,
// the freshly-recorded payment row read back by id, and the society's slug
// for the notification link only.
function sessionClient(options: { societySlug?: string | null } = {}) {
  const societiesFrom = jest.fn();

  const client = {
    from: jest.fn((table: string) => {
      if (table === 'payments') {
        const query: Record<string, jest.Mock> = {};
        query.select = jest.fn(() => query);
        query.eq = jest.fn(() => query);
        query.not = jest.fn(() => query);
        query.order = jest.fn(() => query);
        // fetchAll's terminal call — empty page, so no month-overlap conflicts.
        query.range = jest.fn(async () => ({ data: [], error: null }));
        // The post-RPC read-back of the recorded payment.
        query.single = jest.fn(async () => ({ data: PAYMENT_ROW, error: null }));
        return query;
      }
      if (table === 'units') {
        const query: Record<string, jest.Mock> = {};
        query.select = jest.fn(() => query);
        query.eq = jest.fn(() => query);
        query.single = jest.fn(async () => ({ data: { society_id: SOCIETY_ID }, error: null }));
        return query;
      }
      if (table === 'societies') {
        societiesFrom();
        const query: Record<string, jest.Mock> = {};
        query.select = jest.fn(() => query);
        query.eq = jest.fn(() => query);
        query.single = jest.fn(async () => ({
          data: options.societySlug === undefined ? { slug: SOCIETY_SLUG } : (options.societySlug ? { slug: options.societySlug } : null),
          error: null,
        }));
        return query;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { client, societiesFrom };
}

function serviceClient(paymentId: string | null = PAYMENT_ID, rpcError: { message: string } | null = null) {
  return { rpc: jest.fn(async () => ({ data: rpcError ? null : paymentId, error: rpcError })) };
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialOperator as jest.Mock).mockResolvedValue(OPERATOR_AUTH);
});

describe('POST /api/payments — recorded-payment resident notification', () => {
  it('notifies the paid unit\'s residents with no financial detail, without touching the email path', async () => {
    const { client } = sessionClient();
    (createClient as jest.Mock).mockResolvedValue(client);
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClient());

    const response = await POST(paymentRequest(VALID_PAYMENT));

    expect(response.status).toBe(201);
    expect(notifyUnitResidents).toHaveBeenCalledTimes(1);
    expect(notifyUnitResidents).toHaveBeenCalledWith(SOCIETY_ID, [UNIT_ID], expect.objectContaining({
      title: 'Payment recorded',
      url: `/s/${SOCIETY_SLUG}/my-flat`,
    }));
    // No amount, receipt number or payment mode in the push payload (PWA privacy rule).
    const payload = JSON.stringify((notifyUnitResidents as jest.Mock).mock.calls[0][2]);
    expect(payload).not.toMatch(/2000|RCPT-0001|UPI/);
    // The receipt/email path is untouched — still invoked exactly as before.
    expect(generateAndStoreReceipt).toHaveBeenCalledWith(PAYMENT_ID, SOCIETY_ID);
  });

  it('sends the selected months to the settlement RPC so the recorded payment discharges bills', async () => {
    const { client } = sessionClient();
    (createClient as jest.Mock).mockResolvedValue(client);
    const service = serviceClient();
    (createServiceClient as jest.Mock).mockResolvedValue(service);

    const response = await POST(paymentRequest({
      ...VALID_PAYMENT,
      amount_paid: 10000,
      months_covered: 5,
      months_detail: 'Oct 2025, Nov 2025, Dec 2025, Jan 2026, Feb 2026',
    }));

    expect(response.status).toBe(201);
    expect(service.rpc).toHaveBeenCalledWith('record_manual_payment', expect.objectContaining({
      p_payload: expect.objectContaining({
        bill_ids: [],
        month_periods: [
          { year: 2025, month: 10 }, { year: 2025, month: 11 }, { year: 2025, month: 12 },
          { year: 2026, month: 1 }, { year: 2026, month: 2 },
        ],
      }),
    }));
  });

  it('sends an empty month list when no months were named, leaving the RPC to appropriate oldest-first', async () => {
    const { client } = sessionClient();
    (createClient as jest.Mock).mockResolvedValue(client);
    const service = serviceClient();
    (createServiceClient as jest.Mock).mockResolvedValue(service);

    await POST(paymentRequest(VALID_PAYMENT));

    expect(service.rpc).toHaveBeenCalledWith('record_manual_payment', expect.objectContaining({
      p_payload: expect.objectContaining({ month_periods: [] }),
    }));
  });

  it('falls back to the unscoped path when the society has no slug', async () => {
    const { client } = sessionClient({ societySlug: null });
    (createClient as jest.Mock).mockResolvedValue(client);
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClient());

    await POST(paymentRequest(VALID_PAYMENT));

    expect(notifyUnitResidents).toHaveBeenCalledWith(SOCIETY_ID, [UNIT_ID], expect.objectContaining({ url: '/my-flat' }));
  });

  it('still returns 201 when the notification fails', async () => {
    const { client } = sessionClient();
    (createClient as jest.Mock).mockResolvedValue(client);
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClient());
    (notifyUnitResidents as jest.Mock).mockRejectedValueOnce(new Error('push gateway down'));

    const response = await POST(paymentRequest(VALID_PAYMENT));

    expect(response.status).toBe(201);
  });

  it('does not notify when the transactional record RPC fails', async () => {
    const { client } = sessionClient();
    (createClient as jest.Mock).mockResolvedValue(client);
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClient(null, { message: 'BILL_NOT_PAYABLE' }));

    const response = await POST(paymentRequest(VALID_PAYMENT));

    expect(response.status).toBe(409);
    expect(notifyUnitResidents).not.toHaveBeenCalled();
  });

  it('rejects a non-operator through the financial-operator guard and never touches notify', async () => {
    const denied = Response.json({ error: 'Forbidden' }, { status: 403 });
    (requireFinancialOperator as jest.Mock).mockResolvedValue({ unauthorized: denied });

    const response = await POST(paymentRequest(VALID_PAYMENT));

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
    expect(notifyUnitResidents).not.toHaveBeenCalled();
  });
});
