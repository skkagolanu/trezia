import type { SupabaseClient } from '@supabase/supabase-js';
import { fyStartYearForIsoDate, treasurerNameForDate } from '@/lib/treasurer/for-date';

describe('fyStartYearForIsoDate', () => {
  it.each([
    ['2026-04-01', 2026],
    ['2026-12-31', 2026],
    ['2027-01-01', 2026],
    ['2027-03-31', 2026],
  ])('maps %s to FY starting %i', (date, expected) => {
    expect(fyStartYearForIsoDate(date)).toBe(expected);
  });

  it('rejects a non-ISO accounting date', () => {
    expect(() => fyStartYearForIsoDate('01/04/2026')).toThrow('YYYY-MM-DD');
  });
});

describe('treasurerNameForDate', () => {
  it('scopes the lookup to the society and the record date FY', async () => {
    const query: Record<string, jest.Mock> = {};
    query.select = jest.fn(() => query);
    query.eq = jest.fn(() => query);
    query.maybeSingle = jest.fn(async () => ({
      data: { residents: { full_name: 'FY Treasurer' } },
      error: null,
    }));
    const client = { from: jest.fn(() => query) } as unknown as SupabaseClient;

    await expect(treasurerNameForDate(client, 'society-1', '2027-02-10'))
      .resolves.toBe('FY Treasurer');
    expect(client.from).toHaveBeenCalledWith('fy_treasurers');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'society_id', 'society-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'fy_start_year', 2026);
  });
});
