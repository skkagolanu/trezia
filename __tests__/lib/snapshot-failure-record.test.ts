/** Failed snapshots preserve the last successful timestamp and capacity measurements. */
import { createSnapshot } from '@/lib/snapshots/create';
import { createServiceClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/fetch-all';

jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn(), createClient: jest.fn() }));
jest.mock('@/lib/supabase/fetch-all', () => ({ fetchAll: jest.fn() }));
jest.mock('@/lib/storage/r2', () => ({
  listPrivateAttachmentObjects: jest.fn().mockResolvedValue([]),
  listSocietyArtifactObjects: jest.fn().mockResolvedValue([]),
  uploadGzip: jest.fn(),
  snapshotKeyGz: jest.fn(() => 'snapshots/x.json.gz'),
}));

const SOCIETY_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const PRIOR_USAGE = {
  db_row_count: 2600,
  artifact_bytes: 900,
  snapshot_bytes: 400,
  snapshot_count: 7,
  last_snapshot_at: '2026-08-01T19:30:00.000Z',
  last_snapshot_ratio: 0.2,
  last_snapshot_hash: 'previous-good-hash',
};

// buildBackupSnapshot throws when the required societies row is unavailable —
// the same shape of failure a bad ORDER BY produces via PostgREST.
function serviceClient(options: { priorUsage: typeof PRIOR_USAGE | null }) {
  // Typed parameters so mock.calls[0][1] is the args object rather than never;
  // they are intentionally unread here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const rpc = jest.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: null, error: null }));

  const societiesChain: Record<string, jest.Mock> = {};
  societiesChain.select = jest.fn(() => societiesChain);
  societiesChain.eq = jest.fn(() => societiesChain);
  societiesChain.single = jest.fn(async () => ({ data: null, error: { message: 'column does not exist' } }));

  const configChain: Record<string, jest.Mock> = {};
  configChain.select = jest.fn(() => configChain);
  configChain.eq = jest.fn(() => configChain);
  configChain.single = jest.fn(async () => ({ data: { society_id: SOCIETY_ID }, error: null }));

  const usageChain: Record<string, jest.Mock> = {};
  usageChain.select = jest.fn(() => usageChain);
  usageChain.eq = jest.fn(() => usageChain);
  usageChain.maybeSingle = jest.fn(async () => ({ data: options.priorUsage, error: null }));

  return {
    rpc,
    from: jest.fn((table: string) => {
      if (table === 'societies') return societiesChain;
      if (table === 'society_config') return configChain;
      if (table === 'society_usage_current') return usageChain;
      return societiesChain;
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (fetchAll as jest.Mock).mockResolvedValue([]);
});

describe('createSnapshot failure recording', () => {
  it("records 'FAILED' and still rethrows so the caller counts the society as failed", async () => {
    const client = serviceClient({ priorUsage: PRIOR_USAGE });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await expect(createSnapshot(SOCIETY_ID)).rejects.toThrow();

    expect(client.rpc).toHaveBeenCalledWith('record_society_usage', expect.objectContaining({
      p_society_id: SOCIETY_ID,
      p_last_snapshot_result: 'FAILED',
    }));
  });

  it('preserves the last SUCCESSFUL snapshot time instead of stamping now()', async () => {
    const client = serviceClient({ priorUsage: PRIOR_USAGE });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await expect(createSnapshot(SOCIETY_ID)).rejects.toThrow();

    const args = client.rpc.mock.calls[0][1] as Record<string, unknown>;
    // Stamping now() here would reset isBackupStale()'s age check and hide the outage.
    expect(args.p_last_snapshot_at).toBe(PRIOR_USAGE.last_snapshot_at);
  });

  it('carries the capacity measurement forward rather than zeroing it', async () => {
    const client = serviceClient({ priorUsage: PRIOR_USAGE });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await expect(createSnapshot(SOCIETY_ID)).rejects.toThrow();

    const args = client.rpc.mock.calls[0][1] as Record<string, unknown>;
    // record_society_usage overwrites every column, so zeros here would report
    // the society as empty on /societies.
    expect(args.p_db_row_count).toBe(PRIOR_USAGE.db_row_count);
    expect(args.p_artifact_bytes).toBe(PRIOR_USAGE.artifact_bytes);
    expect(args.p_snapshot_count).toBe(PRIOR_USAGE.snapshot_count);
  });

  it('records the failure even when the society has never been measured', async () => {
    const client = serviceClient({ priorUsage: null });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await expect(createSnapshot(SOCIETY_ID)).rejects.toThrow();

    const args = client.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_last_snapshot_result).toBe('FAILED');
    expect(args.p_last_snapshot_at).toBeNull();
  });
});
