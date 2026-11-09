import { mapWithConcurrency } from '@/app/api/cron/snapshot/route';

describe('snapshot cron concurrency', () => {
  it('runs no more than two society jobs at once while preserving result order', async () => {
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
});
