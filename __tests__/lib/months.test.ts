import { findPaymentMonthOverlaps, parseMonthsDetail } from '@/lib/utils/months';

describe('parseMonthsDetail', () => {
  it('parses a single month', () => {
    expect(parseMonthsDetail('Apr 2026')).toEqual([{ year: 2026, month: 4, label: 'Apr 2026' }]);
  });

  it('parses multiple comma-space separated months', () => {
    expect(parseMonthsDetail('Apr 2026, May 2026, Jun 2026')).toEqual([
      { year: 2026, month: 4, label: 'Apr 2026' },
      { year: 2026, month: 5, label: 'May 2026' },
      { year: 2026, month: 6, label: 'Jun 2026' },
    ]);
  });

  it('returns empty array for null, undefined, and empty string', () => {
    expect(parseMonthsDetail(null)).toEqual([]);
    expect(parseMonthsDetail(undefined)).toEqual([]);
    expect(parseMonthsDetail('')).toEqual([]);
  });

  it('skips malformed entries and keeps valid ones', () => {
    expect(parseMonthsDetail('Apr 2026, bad entry, Jun 2026')).toEqual([
      { year: 2026, month: 4, label: 'Apr 2026' },
      { year: 2026, month: 6, label: 'Jun 2026' },
    ]);
  });

  it('handles FY boundary months (Dec → Jan)', () => {
    expect(parseMonthsDetail('Dec 2025, Jan 2026')).toEqual([
      { year: 2025, month: 12, label: 'Dec 2025' },
      { year: 2026, month: 1,  label: 'Jan 2026' },
    ]);
  });

  it('handles comma-only separator (no space after comma)', () => {
    expect(parseMonthsDetail('Apr 2026,May 2026')).toEqual([
      { year: 2026, month: 4, label: 'Apr 2026' },
      { year: 2026, month: 5, label: 'May 2026' },
    ]);
  });

  it('maps all 12 month abbreviations correctly', () => {
    const months = 'Jan 2025, Feb 2025, Mar 2025, Apr 2025, May 2025, Jun 2025, Jul 2025, Aug 2025, Sep 2025, Oct 2025, Nov 2025, Dec 2025';
    const result = parseMonthsDetail(months);
    expect(result.map(r => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('findPaymentMonthOverlaps', () => {
  const payment = (id: string, unitId: string, detail: string | null) => ({
    id,
    unit_id: unitId,
    months_detail: detail,
    receipt_number: `REC-${id}`,
    payment_date: '2023-03-01',
    amount_paid: 2000,
    flat_number: unitId,
  });

  it('finds the same month claimed by two payments for one flat', () => {
    const result = findPaymentMonthOverlaps([
      payment('1', '101', 'Feb 2023, Mar 2023'),
      payment('2', '101', 'Mar 2023'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ flatNumber: '101', label: 'Mar 2023' });
    expect(result[0]?.payments.map(p => p.id)).toEqual(['1', '2']);
  });

  it('does not mix matching months from different flats', () => {
    expect(findPaymentMonthOverlaps([
      payment('1', '101', 'Mar 2023'),
      payment('2', '102', 'Mar 2023'),
    ])).toEqual([]);
  });

  it('does not count a repeated label twice within one payment', () => {
    expect(findPaymentMonthOverlaps([
      payment('1', '101', 'Mar 2023, Mar 2023'),
    ])).toEqual([]);
  });
});
