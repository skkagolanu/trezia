import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/levies/route';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { treasurerNameForDate } from '@/lib/treasurer/for-date';
import { generateAndStoreLevyReceipt } from '@/lib/pdf/generate-and-store-levy-receipt';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireFinancialOperator: jest.fn() }));
jest.mock('@/lib/treasurer/for-date', () => ({ treasurerNameForDate: jest.fn() }));
jest.mock('@/lib/pdf/generate-and-store-levy-receipt', () => ({ generateAndStoreLevyReceipt: jest.fn() }));

const UNIT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const RESIDENT_ID = 'b1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';

const validBody = {
  unit_id: UNIT_ID,
  resident_id: RESIDENT_ID,
  levy_label: 'AMC-2026',
  amount_paid: 2500,
  payment_date: '2026-07-15',
  payment_mode: 'BANK_TRANSFER',
};

type Scenario = {
  unit?: { id: string; society_id: string } | null;
  resident?: { id: string } | null;
  insertError?: { message: string } | null;
};

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/levies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function supabaseFor(scenario: Scenario = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const unit = scenario.unit === undefined ? { id: UNIT_ID, society_id: SOCIETY_ID } : scenario.unit;
  const resident = scenario.resident === undefined ? { id: RESIDENT_ID } : scenario.resident;

  const unitQuery: Record<string, jest.Mock> = {};
  unitQuery.select = jest.fn(() => unitQuery);
  unitQuery.eq = jest.fn(() => unitQuery);
  unitQuery.single = jest.fn(async () => ({ data: unit, error: unit ? null : { message: 'not found' } }));

  const residentQuery: Record<string, jest.Mock> = {};
  residentQuery.select = jest.fn(() => residentQuery);
  residentQuery.eq = jest.fn(() => residentQuery);
  residentQuery.maybeSingle = jest.fn(async () => ({ data: resident, error: null }));

  const collectionQuery: Record<string, jest.Mock> = {};
  collectionQuery.insert = jest.fn((payload: Record<string, unknown>) => {
    inserted.push(payload);
    return collectionQuery;
  });
  collectionQuery.select = jest.fn(() => collectionQuery);
  collectionQuery.single = jest.fn(async () => scenario.insertError
    ? { data: null, error: scenario.insertError }
    : { data: { id: 'collection-1', ...inserted[0], is_voided: false, created_at: '2026-07-15T00:00:00Z' }, error: null });

  // Migration 067 moved the write from a direct table insert to the
  // record_levy_collection RPC, so the same per-unit advisory lock covers this
  // direct-entry path and a resident's levy-claim approval. Recording the RPC
  // args into `inserted` keeps every "nothing was written" assertion below
  // meaningful without rewriting them.
  const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => {
    if (scenario.insertError) return { data: null, error: scenario.insertError };
    inserted.push(args);
    return {
      data: {
        id: 'collection-1',
        society_id: args.p_society_id,
        unit_id: args.p_unit_id,
        resident_id: args.p_resident_id,
        levy_label: args.p_levy_label,
        amount_paid: args.p_amount_paid,
        payment_mode: args.p_payment_mode,
        recorded_by: args.p_recorded_by,
        is_voided: false,
        created_at: '2026-07-15T00:00:00Z',
      },
      error: null,
    };
  });

  return {
    inserted,
    rpc,
    client: {
      rpc,
      from: jest.fn((table: string) => {
        if (table === 'units') return unitQuery;
        if (table === 'residents') return residentQuery;
        if (table === 'amc_collections') return collectionQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialOperator as jest.Mock).mockResolvedValue({ userId: 'admin-1', societyId: SOCIETY_ID, unauthorized: null });
  (treasurerNameForDate as jest.Mock).mockResolvedValue('Treasurer Name');
  (generateAndStoreLevyReceipt as jest.Mock).mockResolvedValue(null);
});

describe('POST /api/levies', () => {
  it('inserts the selected flat society explicitly and returns 201', async () => {
    const { client, inserted } = supabaseFor();
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request(validBody));
    const json = await response.json();

    expect(response.status).toBe(201);
    // Goes through record_levy_collection so the write takes the same per-unit
    // advisory lock as a resident levy-claim approval and updates the matching
    // levy_assessments row — a direct insert would reintroduce the double-credit
    // race from the treasurer's side.
    expect(inserted[0]).toMatchObject({
      p_unit_id: UNIT_ID,
      p_resident_id: RESIDENT_ID,
      p_society_id: SOCIETY_ID,
      p_levy_label: 'AMC-2026',
      p_amount_paid: 2500,
      p_recorded_by: 'Treasurer Name',
    });
    expect(treasurerNameForDate).toHaveBeenCalledWith(client, SOCIETY_ID, '2026-07-15');
    expect(json.id).toBe('collection-1');
    expect(generateAndStoreLevyReceipt).toHaveBeenCalledWith('collection-1', SOCIETY_ID);
  });

  it('rejects a flat hidden by tenant scope', async () => {
    const { client, inserted } = supabaseFor({ unit: null });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request(validBody));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Unknown flat' });
    expect(inserted).toHaveLength(0);
  });

  it('rejects a caller whose membership guard denies society access', async () => {
    const { client, inserted } = supabaseFor();
    (createClient as jest.Mock).mockResolvedValue(client);
    (requireFinancialOperator as jest.Mock).mockResolvedValue({
      userId: null,
      societyId: null,
      unauthorized: Response.json({ error: 'Society access not configured' }, { status: 403 }),
    });

    const response = await POST(request(validBody));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Society access not configured' });
    expect(inserted).toHaveLength(0);
  });

  it('rejects a resident that does not belong to the selected flat', async () => {
    const { client, inserted } = supabaseFor({ resident: null });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request(validBody));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Resident does not belong to the selected flat' });
    expect(inserted).toHaveLength(0);
  });

  it('surfaces an insert/RLS failure without pretending success', async () => {
    const { client } = supabaseFor({ insertError: { message: 'new row violates row-level security policy' } });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request(validBody));

    expect(response.status).toBe(500);
    // Route deliberately returns a generic message — the raw DB/RLS error must never reach the client.
    expect(await response.json()).toEqual({ error: 'Failed to record AMC payment' });
    expect(generateAndStoreLevyReceipt).not.toHaveBeenCalled();
  });

  it.each([
    ['LEVY_ALREADY_SETTLED', 'This AMC is already paid'],
    ['COLLECTION_EXCEEDS_ASSESSMENT', 'Payment exceeds the outstanding AMC amount'],
    ['LEVY_LABEL_INACTIVE', 'Choose an active AMC year'],
  ])('returns 409 when the levy RPC reports %s', async (message, expectedError) => {
    const { client } = supabaseFor({ insertError: { message } });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request(validBody));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: expectedError });
    expect(generateAndStoreLevyReceipt).not.toHaveBeenCalled();
  });

  it('returns 422 when the levy RPC rejects invalid collection data', async () => {
    const { client } = supabaseFor({ insertError: { message: 'INVALID_LEVY_COLLECTION' } });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request(validBody));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Enter a valid AMC payment' });
    expect(generateAndStoreLevyReceipt).not.toHaveBeenCalled();
  });
});
