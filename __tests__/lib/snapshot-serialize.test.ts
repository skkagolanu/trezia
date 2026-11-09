import { serializeSnapshot, deserializeSnapshot, snapshotContentHash } from '@/lib/snapshots/serialize';

describe('serializeSnapshot', () => {
  const snapshot = { exported_at: '2026-07-29T00:00:00Z', payments: [{ id: 'p1', amount: 100 }], society: { id: 's1' } };

  it('round-trips through gzip', () => {
    const { gzipped } = serializeSnapshot(snapshot);
    expect(deserializeSnapshot(gzipped)).toEqual(snapshot);
  });

  it('reports raw and gzipped sizes and a ratio in (0,1] for real data', () => {
    const big = { exported_at: 'x', rows: Array.from({ length: 500 }, (_, i) => ({ id: i, note: 'repeated text '.repeat(5) })) };
    const { rawSize, gzippedSize, ratio } = serializeSnapshot(big);
    expect(gzippedSize).toBeLessThan(rawSize);
    expect(ratio).toBeCloseTo(gzippedSize / rawSize);
    expect(ratio).toBeLessThan(1);
  });

  it('ignores exported_at when hashing so identical data hashes equal', () => {
    const a = { ...snapshot, exported_at: '2026-07-29T00:00:00Z' };
    const b = { ...snapshot, exported_at: '2026-07-30T09:15:00Z' };
    expect(snapshotContentHash(a)).toBe(snapshotContentHash(b));
  });

  it('hashes are order-independent for object keys but sensitive to values', () => {
    const one = { exported_at: 'x', society: { id: 's1', name: 'A' } };
    const reordered = { exported_at: 'y', society: { name: 'A', id: 's1' } };
    const changed = { exported_at: 'x', society: { id: 's1', name: 'B' } };
    expect(snapshotContentHash(one)).toBe(snapshotContentHash(reordered));
    expect(snapshotContentHash(one)).not.toBe(snapshotContentHash(changed));
  });

  it('detects a changed row via the hash', () => {
    const before = serializeSnapshot(snapshot).sha256;
    const after = serializeSnapshot({ ...snapshot, payments: [{ id: 'p1', amount: 200 }] }).sha256;
    expect(before).not.toBe(after);
  });
});
