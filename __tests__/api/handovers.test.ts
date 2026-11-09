import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/handovers/route';
import { PATCH } from '@/app/api/handovers/[id]/route';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireFinancialOperator: jest.fn() }));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const HANDOVER_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

function request(method: 'POST' | 'PATCH', body: unknown): NextRequest {
  return new Request('http://localhost/api/handovers', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function mutationClient(data: unknown, error: unknown = null) {
  const query: Record<string, jest.Mock> = {};
  query.insert = jest.fn(() => query);
  query.update = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.select = jest.fn(() => query);
  query.single = jest.fn(async () => ({ data, error }));
  query.maybeSingle = jest.fn(async () => ({ data, error }));
  return { client: { from: jest.fn(() => query) }, query };
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialOperator as jest.Mock).mockResolvedValue({
    userId: 'operator-1', role: 'treasurer', societyId: SOCIETY_ID, unauthorized: null,
  });
});

describe('treasurer handover writes', () => {
  const valid = {
    handover_date: '2026-07-19',
    outgoing_treasurer: 'Outgoing Treasurer',
    incoming_treasurer: 'Incoming Treasurer',
    bank_balance: 125000,
    cash_in_hand: 2500,
    outstanding_receivables_note: null,
    notes: 'Keys and records transferred.',
  };

  it('creates with the server-derived society', async () => {
    const { client, query } = mutationClient({ id: HANDOVER_ID, ...valid, society_id: SOCIETY_ID });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request('POST', { ...valid, society_id: 'attacker-society' }));

    expect(response.status).toBe(201);
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ society_id: SOCIETY_ID }));
    expect(query.insert).not.toHaveBeenCalledWith(expect.objectContaining({ society_id: 'attacker-society' }));
  });

  it('rejects invalid values with 422 before opening a database client', async () => {
    const response = await POST(request('POST', { ...valid, bank_balance: -1 }));

    expect(response.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('updates only the requested record inside the operator society', async () => {
    const { client, query } = mutationClient({ id: HANDOVER_ID, notes: 'Updated' });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await PATCH(request('PATCH', { notes: 'Updated' }), { params: Promise.resolve({ id: HANDOVER_ID }) });

    expect(response.status).toBe(200);
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', HANDOVER_ID);
    expect(query.eq).toHaveBeenNthCalledWith(2, 'society_id', SOCIETY_ID);
  });

  it('returns 404 for a missing society-scoped record', async () => {
    const { client } = mutationClient(null);
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await PATCH(request('PATCH', { notes: 'Updated' }), { params: Promise.resolve({ id: HANDOVER_ID }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Handover not found' });
  });

  it('returns a generic 500 without exposing database details', async () => {
    const { client } = mutationClient(null, { message: 'private database detail' });
    (createClient as jest.Mock).mockResolvedValue(client);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(request('POST', valid));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to create handover' });
    expect(consoleError).toHaveBeenCalledWith('[handovers] create failed');
    consoleError.mockRestore();
  });

  it('does not allow a resident past the financial-operator guard', async () => {
    (requireFinancialOperator as jest.Mock).mockResolvedValue({
      unauthorized: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await POST(request('POST', valid));

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });
});
