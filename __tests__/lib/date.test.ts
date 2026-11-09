import { formatDate, formatMonthYear, currentFinancialYear, todayISO, nowTime } from '@/lib/utils/date';

describe('formatDate', () => {
  it('formats an ISO string as dd MMM yyyy', () => {
    expect(formatDate('2026-07-12')).toBe('12 Jul 2026');
  });
  it('formats a Date object', () => {
    expect(formatDate(new Date(2025, 3, 1))).toBe('01 Apr 2025');
  });
  it('returns an em dash for null, undefined, and empty string', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });
  it('returns an em dash for an unparseable string', () => {
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('formatMonthYear', () => {
  it('formats year + 1-based month', () => {
    expect(formatMonthYear(2026, 4)).toBe('Apr 2026');
    expect(formatMonthYear(2025, 12)).toBe('Dec 2025');
  });
});

describe('currentFinancialYear', () => {
  afterEach(() => jest.useRealTimers());

  it('anchors to April of the same year when the date is April or later', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 12)); // Jul 2026
    const fy = currentFinancialYear();
    expect(fy.start).toEqual(new Date(2026, 3, 1));
    expect(fy.end).toEqual(new Date(2027, 2, 31));
    expect(fy.label).toBe('FY 2026-27');
  });

  it('anchors to April of the previous year when the date is before April', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 1, 10)); // Feb 2026
    const fy = currentFinancialYear();
    expect(fy.start).toEqual(new Date(2025, 3, 1));
    expect(fy.label).toBe('FY 2025-26');
  });
});

describe('todayISO / nowTime', () => {
  afterEach(() => jest.useRealTimers());

  it('returns the current date and time in the expected shapes', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 12, 9, 5));
    expect(todayISO()).toBe('2026-07-12');
    expect(nowTime()).toBe('09:05');
  });
});
