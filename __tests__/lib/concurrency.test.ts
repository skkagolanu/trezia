import { mapWithConcurrency, settleWithConcurrency } from '@/lib/concurrency';

describe('mapWithConcurrency', () => {
  it('defaults to two concurrent workers and preserves result order', async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], async value => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return value * 10;
    });

    expect(maximum).toBe(2);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it('honors an explicit concurrency limit', async () => {
    let active = 0;
    let maximum = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], async value => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return value;
    }, 3);

    expect(maximum).toBe(3);
  });
});

describe('settleWithConcurrency', () => {
  it('keeps processing after an individual item rejects and preserves input order', async () => {
    const result = await settleWithConcurrency([1, 2, 3, 4], async value => {
      if (value === 2) throw new Error('boom');
      return value * 10;
    });

    expect(result).toEqual([
      { item: 1, ok: true, value: 10 },
      { item: 2, ok: false, error: 'boom' },
      { item: 3, ok: true, value: 30 },
      { item: 4, ok: true, value: 40 },
    ]);
  });
});
