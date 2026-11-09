import { POST as submitAccessRequest } from '@/app/api/access-requests/route';
import { GET as listSocieties } from '@/app/api/societies/route';
import { createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireAdmin: jest.fn() }));
jest.mock('@/lib/utils/rate-limit', () => ({
  check: jest.fn(() => ({ allowed: true })),
  clientIp: jest.fn(() => '127.0.0.1'),
}));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const OTHER_SOCIETY_ID = 'd1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UNIT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

type Row = Record<string, unknown>;
type QueryRecord = {
  table: string;
  equalities: Array<[string, unknown]>;
  orders: string[];
  ranges: Array<[number, number]>;
};
type MemoryQuery = {
  select: jest.Mock;
  eq: jest.Mock;
  order: jest.Mock;
  range: jest.Mock;
  maybeSingle: jest.Mock;
};

function memoryService(sources: Record<string, Row[]>) {
  const queries: QueryRecord[] = [];
  const rpc = jest.fn(async () => ({ data: 'request-1', error: null }));

  const from = jest.fn((table: string) => {
    const record: QueryRecord = { table, equalities: [], orders: [], ranges: [] };
    queries.push(record);

    const filteredRows = () => (sources[table] ?? []).filter(row =>
      record.equalities.every(([column, value]) => row[column] === value));
    const orderedRows = () => filteredRows().sort((left, right) => {
      for (const column of record.orders) {
        const comparison = String(left[column]).localeCompare(String(right[column]));
        if (comparison !== 0) return comparison;
      }
      return 0;
    });

    const query: MemoryQuery = {
      select: jest.fn(() => query),
      eq: jest.fn((column: string, value: unknown) => {
        record.equalities.push([column, value]);
        return query;
      }),
      order: jest.fn((column: string) => {
        record.orders.push(column);
        return query;
      }),
      range: jest.fn(async (fromIndex: number, toIndex: number) => {
        record.ranges.push([fromIndex, toIndex]);
        return { data: orderedRows().slice(fromIndex, toIndex + 1), error: null };
      }),
      maybeSingle: jest.fn(async () => ({ data: filteredRows()[0] ?? null, error: null })),
    };
    return query;
  });

  return { client: { from, rpc }, queries, rpc };
}

function request(body: unknown) {
  return new Request('http://localhost/api/access-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/societies', () => {
  it('returns a capped redacted active-society list without units', async () => {
    const activeSocieties = Array.from({ length: 101 }, (_, index) => ({
      id: index === 0 ? SOCIETY_ID : `society-${String(index).padStart(3, '0')}`,
      name: `Society ${String(index).padStart(3, '0')}`, status: 'active', is_active: true,
      contact_email: 'must-not-be-public@example.com',
    }));
    const { client, queries } = memoryService({ societies: activeSocieties });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await listSocieties(new Request('http://localhost/api/societies') as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.societies).toHaveLength(100);
    expect(payload.societies[0]).toEqual({ id: expect.any(String), name: expect.any(String) });
    expect(payload.societies[0]).not.toHaveProperty('units');
    expect(payload.societies[0]).not.toHaveProperty('contact_email');
    expect(queries).toHaveLength(1);
    expect(queries[0].ranges).toEqual([[0, 99]]);
  });

  it('returns only capped active non-test flats for the selected active society', async () => {
    const activeUnits = Array.from({ length: 501 }, (_, index) => ({
      id: `unit-${String(index).padStart(4, '0')}`,
      society_id: SOCIETY_ID,
      flat_number: String(index + 1),
      is_active: true,
      is_test_unit: false,
      notes: 'must not be public',
    }));
    const { client, queries } = memoryService({
      societies: [
        { id: SOCIETY_ID, name: 'Active Society', status: 'active', is_active: true, contact_email: 'private@example.com' },
        { id: OTHER_SOCIETY_ID, name: 'Suspended Society', status: 'suspended', is_active: false },
      ],
      units: [
        ...activeUnits,
        { id: 'inactive-unit', society_id: SOCIETY_ID, flat_number: 'X', is_active: false, is_test_unit: false },
        { id: 'test-unit', society_id: SOCIETY_ID, flat_number: 'TEST', is_active: true, is_test_unit: true },
        { id: 'hidden-unit', society_id: OTHER_SOCIETY_ID, flat_number: 'Y', is_active: true, is_test_unit: false },
      ],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await listSocieties(new Request(`http://localhost/api/societies?society_id=${SOCIETY_ID}`) as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.units).toHaveLength(500);
    expect(payload.units[0]).toEqual(expect.objectContaining({ id: expect.any(String), flat_number: expect.any(String) }));
    expect(payload.units[0]).not.toHaveProperty('society_id');

    const societyQueries = queries.filter(query => query.table === 'societies');
    expect(societyQueries[0].equalities).toEqual(expect.arrayContaining([
      ['status', 'active'],
      ['is_active', true],
    ]));
    expect(societyQueries[0].equalities).toEqual(expect.arrayContaining([['id', SOCIETY_ID]]));

    const unitQueries = queries.filter(query => query.table === 'units');
    expect(unitQueries[0].equalities).toEqual(expect.arrayContaining([
      ['is_active', true],
      ['is_test_unit', false],
    ]));
    expect(unitQueries[0].equalities).toEqual(expect.arrayContaining([['society_id', SOCIETY_ID]]));
    expect(unitQueries[0].orders).toEqual(['flat_number', 'id']);
    expect(unitQueries[0].ranges).toEqual([[0, 499]]);
  });

  it('rejects malformed society IDs before querying units', async () => {
    const { client, queries } = memoryService({});
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    const response = await listSocieties(new Request('http://localhost/api/societies?society_id=bad') as never);
    expect(response.status).toBe(422);
    expect(queries).toHaveLength(0);
  });
});

describe('POST /api/access-requests', () => {
  it('submits only after validating an active society and selectable flat', async () => {
    const { client, queries, rpc } = memoryService({
      societies: [{ id: SOCIETY_ID, status: 'active', is_active: true }],
      units: [{ id: UNIT_ID, society_id: SOCIETY_ID, is_active: true, is_test_unit: false }],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await submitAccessRequest(request({
      society_id: SOCIETY_ID,
      unit_id: UNIT_ID,
      email: 'resident@example.com',
    }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('submit_access_request', expect.objectContaining({
      p_society_id: SOCIETY_ID,
      p_unit_id: UNIT_ID,
    }));
    expect(queries.find(query => query.table === 'societies')?.equalities).toEqual(expect.arrayContaining([
      ['status', 'active'],
      ['is_active', true],
    ]));
    expect(queries.find(query => query.table === 'units')?.equalities).toEqual(expect.arrayContaining([
      ['society_id', SOCIETY_ID],
      ['is_active', true],
      ['is_test_unit', false],
    ]));
  });

  it.each([
    {
      label: 'suspended society',
      society: { id: SOCIETY_ID, status: 'suspended', is_active: false },
      unit: { id: UNIT_ID, society_id: SOCIETY_ID, is_active: true, is_test_unit: false },
    },
    {
      label: 'inactive flat',
      society: { id: SOCIETY_ID, status: 'active', is_active: true },
      unit: { id: UNIT_ID, society_id: SOCIETY_ID, is_active: false, is_test_unit: false },
    },
    {
      label: 'test flat',
      society: { id: SOCIETY_ID, status: 'active', is_active: true },
      unit: { id: UNIT_ID, society_id: SOCIETY_ID, is_active: true, is_test_unit: true },
    },
    {
      label: 'flat from another society',
      society: { id: SOCIETY_ID, status: 'active', is_active: true },
      unit: { id: UNIT_ID, society_id: OTHER_SOCIETY_ID, is_active: true, is_test_unit: false },
    },
  ])('rejects a $label with the same non-enumerating response', async ({ society, unit }) => {
    const { client, rpc } = memoryService({ societies: [society], units: [unit] });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await submitAccessRequest(request({
      society_id: SOCIETY_ID,
      unit_id: UNIT_ID,
      email: 'resident@example.com',
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'That society and flat selection is not available.' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
