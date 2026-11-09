import { settleWithConcurrency } from '@/app/api/cron/snapshot/route';

describe('settleWithConcurrency', () => {
  it('keeps processing after an individual item rejects and preserves input order', async () => {
    const visited: number[] = [];
    const result = await settleWithConcurrency([1, 2, 3, 4], async value => {
      visited.push(value);
      if (value === 2) throw new Error('society backup failed');
      return value * 10;
    });

    expect(visited.sort()).toEqual([1, 2, 3, 4]);
    expect(result).toEqual([
      { item: 1, ok: true, value: 10 },
      { item: 2, ok: false, error: 'society backup failed' },
      { item: 3, ok: true, value: 30 },
      { item: 4, ok: true, value: 40 },
    ]);
  });
});
