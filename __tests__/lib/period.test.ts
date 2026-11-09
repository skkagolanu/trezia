import {
  FIRST_FY,
  fyLabel,
  fyOptions,
  fyRange,
  fyStartYearOf,
  lastMonthRange,
  monthRange,
  quarterLabel,
  quarterOptions,
  quarterRange,
  resolvePeriod,
} from '@/lib/utils/period';

describe('fyStartYearOf', () => {
  it('April onwards belongs to the same year',   () => expect(fyStartYearOf(new Date(2026, 3, 1))).toBe(2026));
  it('December belongs to the same year',        () => expect(fyStartYearOf(new Date(2026, 11, 31))).toBe(2026));
  it('January belongs to the previous FY',       () => expect(fyStartYearOf(new Date(2026, 0, 15))).toBe(2025));
  it('March belongs to the previous FY',         () => expect(fyStartYearOf(new Date(2026, 2, 31))).toBe(2025));
});

describe('fyRange / fyLabel', () => {
  it('FY 2025 spans Apr 2025 – Mar 2026', () =>
    expect(fyRange(2025)).toEqual({ from: '2025-04-01', to: '2026-03-31' }));
  it('labels with en dash and 2-digit end year', () => expect(fyLabel(2025)).toBe('FY 2025–26'));
});

describe('monthRange', () => {
  it('normal month',        () => expect(monthRange(2026, 7)).toEqual({ from: '2026-07-01', to: '2026-07-31' }));
  it('30-day month',        () => expect(monthRange(2026, 6)).toEqual({ from: '2026-06-01', to: '2026-06-30' }));
  it('February (non-leap)', () => expect(monthRange(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' }));
  it('February (leap)',     () => expect(monthRange(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' }));
});

describe('fyOptions', () => {
  it('runs from FIRST_FY to the current FY', () => {
    const opts = fyOptions(new Date(2026, 6, 7)); // Jul 2026 → FY 2026
    expect(opts[0]).toEqual({ value: String(FIRST_FY), label: fyLabel(FIRST_FY) });
    expect(opts[opts.length - 1]).toEqual({ value: '2026', label: 'FY 2026–27' });
    expect(opts).toHaveLength(2026 - FIRST_FY + 1);
  });
  it('before April the current FY is last year', () => {
    const opts = fyOptions(new Date(2026, 1, 1)); // Feb 2026 → FY 2025
    expect(opts[opts.length - 1].value).toBe('2025');
  });
});

describe('lastMonthRange', () => {
  it('normal month', () => expect(lastMonthRange(new Date(2026, 6, 7))).toMatchObject({ from: '2026-06-01', to: '2026-06-30', year: 2026, month: 6 }));
  it('crosses the year boundary in January', () => expect(lastMonthRange(new Date(2026, 0, 15))).toMatchObject({ from: '2025-12-01', to: '2025-12-31', year: 2025, month: 12 }));
});

describe('quarterRange / quarterLabel / quarterOptions', () => {
  it('Q1 = Apr–Jun of the FY start year',   () => expect(quarterRange(2026, 1)).toEqual({ from: '2026-04-01', to: '2026-06-30' }));
  it('Q2 = Jul–Sep of the FY start year',   () => expect(quarterRange(2026, 2)).toEqual({ from: '2026-07-01', to: '2026-09-30' }));
  it('Q3 = Oct–Dec of the FY start year',   () => expect(quarterRange(2026, 3)).toEqual({ from: '2026-10-01', to: '2026-12-31' }));
  it('Q4 = Jan–Mar of the FY start year+1', () => expect(quarterRange(2026, 4)).toEqual({ from: '2027-01-01', to: '2027-03-31' }));
  it('label combines quarter and FY',       () => expect(quarterLabel(2026, 1)).toBe('Q1 FY 2026–27'));
  it('quarterOptions returns Q1..Q4',       () => expect(quarterOptions()).toEqual([
    { value: 1, label: 'Q1' }, { value: 2, label: 'Q2' }, { value: 3, label: 'Q3' }, { value: 4, label: 'Q4' },
  ]));
});

describe('resolvePeriod', () => {
  const now = new Date(2026, 6, 7); // 7 Jul 2026

  it('month → current calendar month', () => {
    const r = resolvePeriod({ period: 'month' }, { now });
    expect(r).toMatchObject({ key: 'month', from: '2026-07-01', to: '2026-07-31' });
    expect(r.label).toBe('July 2026');
  });

  it('fy with explicit year', () => {
    const r = resolvePeriod({ period: 'fy', fy: '2023' }, { now });
    expect(r).toMatchObject({ key: 'fy', from: '2023-04-01', to: '2024-03-31', label: 'FY 2023–24' });
  });

  it('fy without year falls back to the current FY', () => {
    const r = resolvePeriod({ period: 'fy' }, { now });
    expect(r).toMatchObject({ from: '2026-04-01', to: '2027-03-31' });
  });

  it('fy with a garbage year falls back to the current FY', () => {
    const r = resolvePeriod({ period: 'fy', fy: 'abc' }, { now });
    expect(r).toMatchObject({ from: '2026-04-01', to: '2027-03-31' });
  });

  it('lastMonth → the calendar month before now', () => {
    const r = resolvePeriod({ period: 'lastMonth' }, { now });
    expect(r).toMatchObject({ key: 'lastMonth', from: '2026-06-01', to: '2026-06-30', label: 'June 2026' });
  });

  it('quarter with explicit fy + q', () => {
    const r = resolvePeriod({ period: 'quarter', fy: '2025', q: '3' }, { now });
    expect(r).toMatchObject({ key: 'quarter', from: '2025-10-01', to: '2025-12-31', label: 'Q3 FY 2025–26' });
  });

  it('quarter without fy/q falls back to the current FY and quarter', () => {
    // now = 7 Jul 2026 → FY 2026, Q2 (Jul–Sep)
    const r = resolvePeriod({ period: 'quarter' }, { now });
    expect(r).toMatchObject({ from: '2026-07-01', to: '2026-09-30', label: 'Q2 FY 2026–27' });
  });

  it('quarter with an out-of-range q falls back to the current quarter', () => {
    const r = resolvePeriod({ period: 'quarter', q: '9' }, { now });
    expect(r).toMatchObject({ label: 'Q2 FY 2026–27' });
  });

  it('all → unbounded', () => {
    const r = resolvePeriod({ period: 'all' }, { now });
    expect(r).toEqual({ key: 'all', label: 'All Time' });
  });

  it('custom passes bounds through', () => {
    const r = resolvePeriod({ period: 'custom', from: '2025-01-15', to: '2025-06-30' }, { now });
    expect(r).toMatchObject({ key: 'custom', from: '2025-01-15', to: '2025-06-30' });
    expect(r.label).toBe('15 Jan 2025 – 30 Jun 2025');
  });

  it('custom with only from', () => {
    const r = resolvePeriod({ period: 'custom', from: '2025-01-15' }, { now });
    expect(r.to).toBeUndefined();
    expect(r.label).toBe('From 15 Jan 2025');
  });

  it('custom with only to', () => {
    const r = resolvePeriod({ period: 'custom', to: '2025-06-30' }, { now });
    expect(r.from).toBeUndefined();
    expect(r.label).toBe('Until 30 Jun 2025');
  });

  it('custom with neither bound', () => {
    const r = resolvePeriod({ period: 'custom' }, { now });
    expect(r).toMatchObject({ key: 'custom', label: 'Custom range' });
  });

  it('unknown period falls back to defaultKey', () => {
    expect(resolvePeriod({ period: 'weird' }, { now, defaultKey: 'fy' }).key).toBe('fy');
    expect(resolvePeriod({}, { now, defaultKey: 'all' }).key).toBe('all');
  });

  it('missing period and no defaultKey → month', () => {
    expect(resolvePeriod({}, { now }).key).toBe('month');
  });
});
