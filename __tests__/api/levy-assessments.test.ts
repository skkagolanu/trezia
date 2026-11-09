import type { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/levy-assessments/route';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireFinancialOperator: jest.fn() }));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';

const OPERATOR_AUTH = { userId: 'admin-1', role: 'admin', societyId: SOCIETY_ID, unauthorized: null };

function postRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/levy-assessments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function getRequest(query: string): NextRequest {
  return new Request(`http://localhost/api/levy-assessments${query}`) as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialOperator as jest.Mock).mockResolvedValue(OPERATOR_AUTH);
});

describe('POST /api/levy-assessments', () => {
  it('raises a levy for the caller\'s own society via the service-role RPC and returns 201', async () => {
    const rpc = jest.fn(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('raise_levy_assessment');
      expect(args).toEqual({ p_society_id: SOCIETY_ID, p_levy_label: 'AMC-2027', p_amount: 3000 });
      return { data: [{ created_count: 40, skipped_count: 2, total_units: 42 }], error: null };
    });
    (createServiceClient as jest.Mock).mockResolvedValue({ rpc });

    const response = await POST(postRequest({ levy_label: 'AMC-2027', amount: 3000 }));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json).toEqual({ created_count: 40, skipped_count: 2, total_units: 42 });
  });

  it('rejects a caller the financial-operator guard denies', async () => {
    (requireFinancialOperator as jest.Mock).mockResolvedValue({
      userId: null, role: null, societyId: null,
      unauthorized: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await POST(postRequest({ levy_label: 'AMC-2027', amount: 3000 }));

    expect(response.status).toBe(403);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('returns 422 for a missing or invalid levy label', async () => {
    const response = await POST(postRequest({ levy_label: '', amount: 3000 }));

    expect(response.status).toBe(422);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('returns 422 for a non-positive amount', async () => {
    const response = await POST(postRequest({ levy_label: 'AMC-2027', amount: 0 }));

    expect(response.status).toBe(422);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('rejects fractional paise before calling the database', async () => {
    const response = await POST(postRequest({ levy_label: 'AMC-2027', amount: 3000.001 }));

    expect(response.status).toBe(422);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid JSON body', async () => {
    const request = new Request('http://localhost/api/levy-assessments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    }) as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('maps INVALID_LEVY_ASSESSMENT from the RPC to 422', async () => {
    const rpc = jest.fn(async () => ({ data: null, error: { message: 'INVALID_LEVY_ASSESSMENT' } }));
    (createServiceClient as jest.Mock).mockResolvedValue({ rpc });

    const response = await POST(postRequest({ levy_label: 'AMC-2027', amount: 3000 }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Choose an active AMC year and enter a valid positive amount' });
  });

  it('returns a generic 500 for an unmapped RPC failure without leaking the raw error', async () => {
    const rpc = jest.fn(async () => ({ data: null, error: { message: 'unexpected db error' } }));
    (createServiceClient as jest.Mock).mockResolvedValue({ rpc });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(postRequest({ levy_label: 'AMC-2027', amount: 3000 }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not raise the AMC' });
    consoleError.mockRestore();
  });
});

describe('GET /api/levy-assessments (preview)', () => {
  function countQuery(count: number): Record<string, unknown> {
    const q: Record<string, unknown> = {};
    q.select = jest.fn(() => q);
    q.eq = jest.fn(() => q);
    // eq() chain resolves to the final result — mimic PostgREST's thenable builder.
    q.then = (resolve: (value: { count: number; error: null }) => void) => resolve({ count, error: null });
    return q;
  }

  function sessionClientFor(totalUnits: number, alreadyAssessed: number) {
    const from = jest.fn((table: string) => {
      if (table === 'units') return countQuery(totalUnits);
      if (table === 'levy_assessments') return countQuery(alreadyAssessed);
      throw new Error(`Unexpected table ${table}`);
    });
    return { from };
  }

  it('returns total, already-assessed, and to-create counts for the requested label', async () => {
    (createClient as jest.Mock).mockResolvedValue(sessionClientFor(42, 2));

    const response = await GET(getRequest('?levy_label=AMC-2027'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ totalUnits: 42, alreadyAssessed: 2, toCreate: 40 });
  });

  it('rejects a caller the financial-operator guard denies', async () => {
    (requireFinancialOperator as jest.Mock).mockResolvedValue({
      userId: null, role: null, societyId: null,
      unauthorized: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await GET(getRequest('?levy_label=AMC-2027'));

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns 422 for a missing levy_label', async () => {
    const response = await GET(getRequest(''));

    expect(response.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });
});
