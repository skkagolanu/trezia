import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/bills/route';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { notifySocietyResidents } from '@/lib/notifications/notify';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({
  requireFinancialOperator: jest.fn(),
  requireFinancialReader: jest.fn(),
}));
jest.mock('@/lib/notifications/notify', () => ({ notifySocietyResidents: jest.fn().mockResolvedValue(undefined) }));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SOCIETY_SLUG = 'green-heights';

const OPERATOR_AUTH = { userId: 'treasurer-1', role: 'treasurer', societyId: SOCIETY_ID, unauthorized: null };

function bulkRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/bills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

// Dispatches by table: society_config (single-row config lookup), units
// (active-unit list), bills (the batched upsert), societies (slug lookup for
// the notification link only — never queried when nothing was created).
function bulkGenerationClient(options: {
  config?: { monthly_maintenance_amount: number | null; maintenance_payment_window_days: number | null } | null;
  units?: Array<{ id: string; flat_number: string }>;
  createdBills?: Array<{ id: string; invoice_number: string; unit_id: string }>;
  societySlug?: string | null;
}) {
  const societiesFrom = jest.fn();

  const client = {
    from: jest.fn((table: string) => {
      if (table === 'society_config') {
        const query: Record<string, jest.Mock> = {};
        query.select = jest.fn(() => query);
        query.eq = jest.fn(() => query);
        query.single = jest.fn(async () => ({ data: options.config ?? null, error: null }));
        return query;
      }
      if (table === 'units') {
        const query: Record<string, jest.Mock> = {};
        query.select = jest.fn(() => query);
        query.eq = jest.fn(() => query);
        query.order = jest.fn(async () => ({ data: options.units ?? [], error: null }));
        return query;
      }
      if (table === 'bills') {
        const query: Record<string, jest.Mock> = {};
        query.upsert = jest.fn(() => query);
        query.select = jest.fn(async () => ({ data: options.createdBills ?? [], error: null }));
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

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialOperator as jest.Mock).mockResolvedValue(OPERATOR_AUTH);
});

describe('POST /api/bills — bulk generation resident notification', () => {
  const VALID_CONFIG = { monthly_maintenance_amount: 2500, maintenance_payment_window_days: 7 };
  const UNITS = [
    { id: 'unit-1', flat_number: '101' },
    { id: 'unit-2', flat_number: '102' },
  ];
  const CREATED = [
    { id: 'bill-1', invoice_number: 'AUG/101/26', unit_id: 'unit-1' },
    { id: 'bill-2', invoice_number: 'AUG/102/26', unit_id: 'unit-2' },
  ];

  it('notifies residents exactly once for the society, not once per bill, with no financial detail', async () => {
    const { client } = bulkGenerationClient({ config: VALID_CONFIG, units: UNITS, createdBills: CREATED });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(bulkRequest({ bill_period_year: 2026, bill_period_month: 8 }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ created: 2, bills: CREATED });
    expect(notifySocietyResidents).toHaveBeenCalledTimes(1);
    expect(notifySocietyResidents).toHaveBeenCalledWith(SOCIETY_ID, expect.objectContaining({
      title: 'New bill posted',
      url: `/s/${SOCIETY_SLUG}/my-flat`,
    }));
    const payload = JSON.stringify((notifySocietyResidents as jest.Mock).mock.calls[0][1]);
    expect(payload).not.toMatch(/2500|101|102|AUG/);
  });

  it('does not notify when the batch creates zero bills', async () => {
    const { client } = bulkGenerationClient({ config: VALID_CONFIG, units: UNITS, createdBills: [] });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(bulkRequest({ bill_period_year: 2026, bill_period_month: 8 }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ created: 0, bills: [] });
    expect(notifySocietyResidents).not.toHaveBeenCalled();
  });

  it('falls back to the unscoped path when the society has no slug', async () => {
    const { client } = bulkGenerationClient({ config: VALID_CONFIG, units: UNITS, createdBills: CREATED, societySlug: null });
    (createClient as jest.Mock).mockResolvedValue(client);

    await POST(bulkRequest({ bill_period_year: 2026, bill_period_month: 8 }));

    expect(notifySocietyResidents).toHaveBeenCalledWith(SOCIETY_ID, expect.objectContaining({ url: '/my-flat' }));
  });

  it('still returns 201 with the created count when the notification fails', async () => {
    const { client } = bulkGenerationClient({ config: VALID_CONFIG, units: UNITS, createdBills: CREATED });
    (createClient as jest.Mock).mockResolvedValue(client);
    (notifySocietyResidents as jest.Mock).mockRejectedValueOnce(new Error('push gateway down'));

    const response = await POST(bulkRequest({ bill_period_year: 2026, bill_period_month: 8 }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ created: 2, bills: CREATED });
  });

  it('rejects a non-operator through the financial-operator guard and never touches notify', async () => {
    const denied = Response.json({ error: 'Forbidden' }, { status: 403 });
    (requireFinancialOperator as jest.Mock).mockResolvedValue({ unauthorized: denied });

    const response = await POST(bulkRequest({ bill_period_year: 2026, bill_period_month: 8 }));

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
    expect(notifySocietyResidents).not.toHaveBeenCalled();
  });
});
