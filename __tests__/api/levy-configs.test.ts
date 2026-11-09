import type { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/levy-configs/route';
import { PATCH } from '@/app/api/levy-configs/[id]/route';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialSetupManager } from '@/lib/supabase/require-auth';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireFinancialSetupManager: jest.fn() }));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const ADMIN_AUTH = { userId: 'admin-1', societyId: SOCIETY_ID, unauthorized: null };

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as NextRequest;
}

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

function supabaseFor(options: {
  list?: QueryResult;
  insert?: QueryResult;
  update?: QueryResult;
} = {}) {
  const listResult = options.list ?? { data: [], error: null };
  const insertResult = options.insert ?? { data: null, error: null };
  const updateResult = options.update ?? { data: null, error: null };

  const selectChain: Record<string, jest.Mock> = {};
  selectChain.select = jest.fn(() => selectChain);
  selectChain.order = jest.fn(async () => listResult);

  const insertChain: Record<string, jest.Mock> = {};
  insertChain.insert = jest.fn(() => insertChain);
  insertChain.select = jest.fn(() => insertChain);
  insertChain.single = jest.fn(async () => insertResult);

  const updateChain: Record<string, jest.Mock> = {};
  updateChain.update = jest.fn(() => updateChain);
  updateChain.eq = jest.fn(() => updateChain);
  updateChain.select = jest.fn(() => updateChain);
  updateChain.single = jest.fn(async () => updateResult);

  return {
    insertChain,
    updateChain,
    client: {
      from: jest.fn(() => ({
        select: selectChain.select,
        insert: insertChain.insert,
        update: updateChain.update,
      })),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialSetupManager as jest.Mock).mockResolvedValue(ADMIN_AUTH);
});

describe('GET /api/levy-configs', () => {
  it('rejects an unauthorized caller', async () => {
    (requireFinancialSetupManager as jest.Mock).mockResolvedValue({
      unauthorized: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    const response = await GET();
    expect(response.status).toBe(403);
  });
});

describe('POST /api/levy-configs', () => {
  it('rejects new CMC and free-text charge labels', async () => {
    const { client, insertChain } = supabaseFor();
    (createClient as jest.Mock).mockResolvedValue(client);

    for (const levy_label of ['Lift repair fund', 'CMC-2027', 'AMC-June-2027', 'AMC-27']) {
      const response = await POST(jsonRequest('http://localhost/api/levy-configs', 'POST', {
        levy_label,
        default_amount: 500,
      }));
      expect(response.status).toBe(422);
      expect((await response.json()).error).toMatch(/AMC.*four-digit year/i);
    }
    expect(insertChain.insert).not.toHaveBeenCalled();
  });

  it('still rejects a label that is empty, over-long, or carries control characters', async () => {
    const { client, insertChain } = supabaseFor();
    (createClient as jest.Mock).mockResolvedValue(client);


    for (const levy_label of ['', 'x'.repeat(61), 'Bad\nLabel', '<script>']) {
      const response = await POST(jsonRequest('http://localhost/api/levy-configs', 'POST', {
        levy_label,
        default_amount: 500,
      }));
      expect(response.status).toBe(422);
    }
    expect(insertChain.insert).not.toHaveBeenCalled();
  });

  it('accepts one AMC label with a four-digit year', async () => {
    const { client, insertChain } = supabaseFor({
      insert: { data: { id: 'lc-2', levy_label: 'AMC-2027', default_amount: 2300 }, error: null },
    });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(jsonRequest('http://localhost/api/levy-configs', 'POST', {
      levy_label: 'AMC-2027',
      default_amount: 2300,
    }));

    expect(response.status).toBe(201);
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({ levy_label: 'AMC-2027' }));
  });

  it('rejects a negative default amount on an otherwise-valid label with a specific message', async () => {
    const { client } = supabaseFor();
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(jsonRequest('http://localhost/api/levy-configs', 'POST', {
      levy_label: 'AMC-2027',
      default_amount: -5,
    }));

    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error).toBe('Amount must be 0 or more');
  });

  it('rejects a duplicate label with a 409', async () => {
    const { client } = supabaseFor({
      insert: { data: null, error: { message: 'duplicate key value', code: '23505' } },
    });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(jsonRequest('http://localhost/api/levy-configs', 'POST', {
      levy_label: 'AMC-2027',
      default_amount: 100,
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('AMC is already configured for that year');
  });

  it('rejects invalid JSON', async () => {
    const response = await POST(new Request('http://localhost/api/levy-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    }) as NextRequest);
    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/levy-configs/[id]', () => {
  it('updates the default amount', async () => {
    const { client, updateChain } = supabaseFor({
      update: { data: { id: 'lc-1', default_amount: 750 }, error: null },
    });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await PATCH(
      jsonRequest('http://localhost/api/levy-configs/lc-1', 'PATCH', { default_amount: 750 }),
      { params: Promise.resolve({ id: 'lc-1' }) },
    );

    expect(response.status).toBe(200);
    expect(updateChain.update).toHaveBeenCalledWith({ default_amount: 750 });
  });

  it('surfaces the specific validation issue for an invalid amount', async () => {
    const { client } = supabaseFor();
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await PATCH(
      jsonRequest('http://localhost/api/levy-configs/lc-1', 'PATCH', { default_amount: -1 }),
      { params: Promise.resolve({ id: 'lc-1' }) },
    );

    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error).not.toBe('Validation failed');
  });
});
