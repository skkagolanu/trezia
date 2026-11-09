import { GET } from '@/app/api/me/societies/route';
import { listUserSocieties } from '@/lib/supabase/require-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { listSnapshotObjects } from '@/lib/storage/r2';
import type { AppRole } from '@/types/database';

jest.mock('@/lib/supabase/require-auth', () => ({ listUserSocieties: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));
jest.mock('@/lib/storage/r2', () => ({ listSnapshotObjects: jest.fn() }));

function society(id: string, role: AppRole) {
  return {
    id,
    slug: id,
    name: `Society ${id}`,
    shortName: id.toUpperCase(),
    status: 'active' as const,
    role,
    unitId: role === 'resident' ? `unit-${id}` : null,
  };
}

type QueryChain<T> = {
  select: jest.Mock;
  eq: jest.Mock;
  maybeSingle: jest.Mock;
  then: PromiseLike<T>['then'];
};

function query<T>(result: T): QueryChain<T> {
  const chain = {} as QueryChain<T>;
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => result);
  chain.then = (onfulfilled, onrejected) => Promise.resolve(result).then(onfulfilled, onrejected);
  return chain;
}

function privilegedService() {
  const tables: Record<string, QueryChain<unknown>> = {
    units: query({ count: 12, error: null }),
    society_memberships: query({ count: 14, error: null }),
    society_usage_current: query({ data: {
      measured_at: '2026-08-24T00:00:00.000Z',
      db_row_count: 500,
      artifact_bytes: 600,
      snapshot_bytes: 700,
      snapshot_count: 3,
      last_snapshot_result: 'UPLOADED',
      last_snapshot_ratio: 0.5,
    }, error: null }),
    society_config: query({ data: { agent_enabled: true, agent_daily_society_limit: 20 }, error: null }),
    usage_counters: query({ data: { count: 4 }, error: null }),
  };
  return { from: jest.fn((table: string) => tables[table]) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('returns 401 without an authenticated society context', async () => {
  (listUserSocieties as jest.Mock).mockResolvedValue(null);

  const response = await GET();

  expect(response.status).toBe(401);
  expect(createServiceClient).not.toHaveBeenCalled();
});

it.each(['resident', 'treasurer'] as const)('never loads or returns privileged metrics for a %s-only user', async role => {
  (listUserSocieties as jest.Mock).mockResolvedValue({
    userId: 'user-1',
    isPlatformOwner: false,
    societies: [society('basic', role)],
  });

  const response = await GET();
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.societies[0]).toMatchObject({ id: 'basic', role, metrics: null });
  expect(createServiceClient).not.toHaveBeenCalled();
  expect(listSnapshotObjects).not.toHaveBeenCalled();
});

it('loads privileged metrics only for the admin membership in a mixed-role account', async () => {
  (listUserSocieties as jest.Mock).mockResolvedValue({
    userId: 'user-1',
    isPlatformOwner: false,
    societies: [society('resident-society', 'resident'), society('admin-society', 'admin')],
  });
  const client = privilegedService();
  (createServiceClient as jest.Mock).mockResolvedValue(client);
  (listSnapshotObjects as jest.Mock).mockResolvedValue([{ lastModified: new Date('2026-08-23T12:00:00.000Z') }]);

  const response = await GET();
  const body = await response.json();

  expect(body.societies[0].metrics).toEqual({ access: null, backups: null, agent: null });
  expect(body.societies[1].metrics).toMatchObject({
    access: { unitCount: 12, accountCount: 14 },
    backups: { lastSnapshotAt: '2026-08-23T12:00:00.000Z' },
    agent: { enabled: true, used: 4, limit: 20 },
  });
  expect(listSnapshotObjects).toHaveBeenCalledTimes(1);
  expect(listSnapshotObjects).toHaveBeenCalledWith('admin-society');
  for (const table of ['units', 'society_memberships', 'society_usage_current', 'society_config', 'usage_counters']) {
    expect(client.from).toHaveBeenCalledWith(table);
  }
});
