import { NextRequest } from 'next/server';
import { GET } from '@/app/api/payments/form-context/route';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireFinancialOperator: jest.fn() }));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const auth = { userId: 'treasurer-1', role: 'treasurer', societyId: SOCIETY_ID, unauthorized: null };

function resolvedQuery(data: unknown) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'order']) query[method] = jest.fn(() => query);
  query.then = jest.fn((resolve: (value: { data: unknown; error: null }) => unknown) => resolve({ data, error: null }));
  return query;
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialOperator as jest.Mock).mockResolvedValue(auth);
});

describe('GET /api/payments/form-context', () => {
  it('loads tenant-scoped flat and levy options through the authenticated server session', async () => {
    const units = resolvedQuery([{ id: 'unit-1', flat_number: 'A-301' }]);
    const levies = resolvedQuery([{ levy_label: 'Lift AMC 2026' }]);
    const client = {
      from: jest.fn((table: string) => table === 'units' ? units : levies),
    };
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await GET(new NextRequest('http://localhost/api/payments/form-context'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      units: [{ id: 'unit-1', flat_number: 'A-301' }],
      levy_labels: ['Lift AMC 2026'],
    });
    expect(units.eq).toHaveBeenCalledWith('society_id', SOCIETY_ID);
    expect(levies.eq).toHaveBeenCalledWith('society_id', SOCIETY_ID);
  });

  it('denies non-financial users before querying form data', async () => {
    const denied = Response.json({ error: 'Forbidden' }, { status: 403 });
    (requireFinancialOperator as jest.Mock).mockResolvedValue({ unauthorized: denied });

    const response = await GET(new NextRequest('http://localhost/api/payments/form-context'));

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });
});
