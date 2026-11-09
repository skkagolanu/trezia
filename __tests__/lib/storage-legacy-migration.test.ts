import {
  collectPaginatedObjects,
  compatibleObjectCandidates,
  migrateLegacySnapshots,
  type LegacySnapshotStore,
} from '@/lib/storage/legacy-migration';

const bytes = (value: string) => new TextEncoder().encode(value);

function store(initial: Record<string, string>, listed = Object.keys(initial)): LegacySnapshotStore & { copied: string[] } {
  const objects = new Map(Object.entries(initial).map(([key, value]) => [key, bytes(value)]));
  const copied: string[] = [];
  return {
    copied,
    list: async () => listed.map(key => ({ key, size: objects.get(key)?.byteLength ?? 0 })),
    exists: async key => objects.has(key),
    read: async key => {
      const value = objects.get(key);
      if (!value) throw new Error(`missing ${key}`);
      return value;
    },
    copy: async (source, target) => {
      copied.push(`${source}->${target}`);
      objects.set(target, objects.get(source)!);
    },
  };
}

describe('R2 pagination', () => {
  it('collects listings beyond 1,000 objects', async () => {
    const first = Array.from({ length: 1000 }, (_, index) => ({ key: `snapshots/${index}.json`, size: index }));
    const second = [{ key: 'snapshots/1000.json', size: 1000 }, { key: 'snapshots/1001.json', size: 1001 }];
    const listPage = jest.fn(async (token?: string) => token
      ? { objects: second, isTruncated: false }
      : { objects: first, isTruncated: true, nextContinuationToken: 'page-2' });
    const result = await collectPaginatedObjects('snapshots/', listPage);
    expect(result).toHaveLength(1002);
    expect(listPage).toHaveBeenNthCalledWith(2, 'page-2');
  });

  it('fails a truncated response without a continuation token', async () => {
    await expect(collectPaginatedObjects('snapshots/', async () => ({ objects: [], isTruncated: true })))
      .rejects.toThrow('without a continuation token');
  });
});

describe('legacy snapshot migration', () => {
  it('dry-runs with a source SHA-256 and no copy', async () => {
    const fake = store({ 'snapshots/old.json': 'payload' });
    const result = await migrateLegacySnapshots(fake, 'society-a', { dryRun: true });
    expect(result).toEqual([expect.objectContaining({ action: 'would-copy', size: 7, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
    expect(fake.copied).toEqual([]);
  });

  it('copies, verifies, and treats an identical retry as idempotent', async () => {
    const fake = store({ 'snapshots/old.json': 'payload' });
    await expect(migrateLegacySnapshots(fake, 'society-a', { dryRun: false }))
      .resolves.toEqual([expect.objectContaining({ action: 'copied' })]);
    await expect(migrateLegacySnapshots(fake, 'society-a', { dryRun: false }))
      .resolves.toEqual([expect.objectContaining({ action: 'already-verified' })]);
    expect(fake.copied).toEqual(['snapshots/old.json->snapshots/society-a/old.json']);
  });

  it('refuses a conflicting destination', async () => {
    const fake = store({ 'snapshots/old.json': 'source', 'snapshots/society-a/old.json': 'different' }, ['snapshots/old.json']);
    await expect(migrateLegacySnapshots(fake, 'society-a', { dryRun: false })).rejects.toThrow('conflicts with');
  });

  it('detects a bad copy result', async () => {
    let copied = false;
    const fake: LegacySnapshotStore = {
      list: async () => [{ key: 'snapshots/old.json', size: 6 }],
      exists: async () => false,
      read: async key => key === 'snapshots/old.json' ? bytes('source') : copied ? bytes('corrupt') : Promise.reject(new Error('missing')),
      copy: async () => { copied = true; },
    };
    await expect(migrateLegacySnapshots(fake, 'society-a', { dryRun: false })).rejects.toThrow('failed verification');
  });
});

describe('legacy document compatibility', () => {
  it('only considers an unscoped key for a society carrying the marker', () => {
    expect(compatibleObjectCandidates(null, 'receipts/a/R1.pdf', 'receipts/R1.pdf')).toEqual(['receipts/a/R1.pdf']);
    expect(compatibleObjectCandidates('unscoped-v1', 'receipts/a/R1.pdf', 'receipts/R1.pdf')).toEqual([
      'receipts/a/R1.pdf',
      'receipts/R1.pdf',
    ]);
  });
});
