import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/gdpr-cleanup/route';
import { createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));

const BATCH_SIZE = 500;

type Batch = {
  data: Array<{ id: string }> | null;
  error: { message: string } | null;
};

function request(authorization?: string): NextRequest {
  const headers = authorization ? { authorization } : undefined;
  return new Request('http://localhost/api/cron/gdpr-cleanup', { headers }) as NextRequest;
}

function residentsFor(
  batches: Batch[],
  options: { updateErrorAt?: number } = {},
) {
  const selectQueries: Array<Record<string, jest.Mock>> = [];
  const updateQueries: Array<Record<string, jest.Mock>> = [];
  const updatedIds: string[][] = [];
  let selectIndex = 0;
  let updateIndex = 0;
  let expectSelect = true;

  const client = {
    from: jest.fn((table: string) => {
      expect(table).toBe('residents');

      if (expectSelect) {
        expectSelect = false;
        const batch = batches[selectIndex++] ?? { data: [], error: null };
        const query: Record<string, jest.Mock> = {};
        query.select = jest.fn(() => query);
        query.eq = jest.fn(() => query);
        query.lte = jest.fn(() => query);
        query.or = jest.fn(() => query);
        query.order = jest.fn(() => query);
        query.limit = jest.fn(() => query);
        query.gt = jest.fn(() => query);
        query.then = jest.fn((resolve: (value: Batch) => unknown) => resolve(batch));
        selectQueries.push(query);
        return query;
      }

      expectSelect = true;
      const currentUpdate = updateIndex++;
      const query: Record<string, jest.Mock> = {};
      query.update = jest.fn(() => query);
      query.in = jest.fn(async (_column: string, ids: string[]) => {
        updatedIds.push(ids);
        return currentUpdate === options.updateErrorAt
          ? { error: { message: 'private resident update detail' } }
          : { error: null };
      });
      updateQueries.push(query);
      return query;
    }),
  };

  return { client, selectQueries, updateQueries, updatedIds };
}

function ids(from: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `resident-${String(from + index).padStart(4, '0')}`,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = 'cron-test-secret';
  jest.useFakeTimers().setSystemTime(new Date('2026-07-19T12:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.CRON_SECRET;
});

describe('GET /api/cron/gdpr-cleanup', () => {
  it('rejects a request without the cron authorization', async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Unauthorized');
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('returns zero when no resident is eligible', async () => {
    const { client, selectQueries, updateQueries } = residentsFor([{ data: [], error: null }]);
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await GET(request('Bearer cron-test-secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, erased: 0 });
    expect(selectQueries[0].select).toHaveBeenCalledWith('id');
    expect(selectQueries[0].lte).toHaveBeenCalledWith('move_out_date', '2026-06-19');
    expect(updateQueries).toHaveLength(0);
  });

  it('clears every eligible resident across the 1,000-row response cap', async () => {
    const { client, selectQueries, updatedIds } = residentsFor([
      { data: ids(1, BATCH_SIZE), error: null },
      { data: ids(501, BATCH_SIZE), error: null },
      { data: ids(1001, 1), error: null },
    ]);
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await GET(request('Bearer cron-test-secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, erased: 1001 });
    expect(selectQueries).toHaveLength(3);
    expect(updatedIds.map(batch => batch.length)).toEqual([500, 500, 1]);
    expect(updatedIds.flat()).toHaveLength(1001);
  });

  it('advances each query from the last stable id instead of using offsets', async () => {
    const firstBatch = ids(1, BATCH_SIZE);
    const secondBatch = ids(501, 2);
    const { client, selectQueries } = residentsFor([
      { data: firstBatch, error: null },
      { data: secondBatch, error: null },
    ]);
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await GET(request('Bearer cron-test-secret'));

    expect(selectQueries[0].order).toHaveBeenCalledWith('id', { ascending: true });
    expect(selectQueries[0].limit).toHaveBeenCalledWith(BATCH_SIZE);
    expect(selectQueries[0].gt).not.toHaveBeenCalled();
    expect(selectQueries[1].gt).toHaveBeenCalledWith('id', 'resident-0500');
  });

  it('returns a generic failure when selecting residents fails without logging PII', async () => {
    const { client } = residentsFor([
      { data: null, error: { message: 'private resident select detail' } },
    ]);
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await GET(request('Bearer cron-test-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'Cleanup failed' });
    expect(consoleError).toHaveBeenCalledWith('[cron/gdpr-cleanup] failed');
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('private resident'));
    consoleError.mockRestore();
  });

  it('returns a generic failure when a bounded update fails without logging PII', async () => {
    const { client, updatedIds } = residentsFor(
      [{ data: ids(1, 2), error: null }],
      { updateErrorAt: 0 },
    );
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await GET(request('Bearer cron-test-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'Cleanup failed' });
    expect(updatedIds).toEqual([['resident-0001', 'resident-0002']]);
    expect(consoleError).toHaveBeenCalledWith('[cron/gdpr-cleanup] failed');
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('private resident'));
    consoleError.mockRestore();
  });
});
