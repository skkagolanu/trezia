import { addDays, selectUnpaidBills } from '@/lib/utils/dues-notice';

describe('addDays', () => {
  it('adds days within a month', () => {
    expect(addDays('2026-06-01', 7)).toBe('2026-06-08');
  });
  it('rolls over month and year boundaries', () => {
    expect(addDays('2025-12-28', 7)).toBe('2026-01-04');
  });
  it('handles zero days', () => {
    expect(addDays('2026-02-15', 0)).toBe('2026-02-15');
  });
});

describe('selectUnpaidBills', () => {
  it('always includes OVERDUE bills', () => {
    const bills = [{ bill_period_year: 2025, bill_period_month: 1, status: 'OVERDUE', due_date: '2025-01-07' }];
    expect(selectUnpaidBills(bills)).toHaveLength(1);
  });

  it('includes ISSUED bills regardless of their due date', () => {
    const bills = [{ bill_period_year: 2026, bill_period_month: 6, status: 'ISSUED', due_date: '2026-06-07' }];
    expect(selectUnpaidBills(bills)).toHaveLength(1);
  });

  it('excludes non-payable bill states', () => {
    const bills = [
      { bill_period_year: 2026, bill_period_month: 6, status: 'DRAFT', due_date: '2026-06-15' },
      { bill_period_year: 2026, bill_period_month: 7, status: 'CANCELLED', due_date: '2026-07-07' },
    ];
    expect(selectUnpaidBills(bills)).toEqual([]);
  });

  it('sorts oldest first', () => {
    const bills = [
      { bill_period_year: 2026, bill_period_month: 2, status: 'OVERDUE', due_date: '2026-02-07' },
      { bill_period_year: 2025, bill_period_month: 11, status: 'OVERDUE', due_date: '2025-11-07' },
    ];
    const out = selectUnpaidBills(bills);
    expect(out.map(b => `${b.bill_period_year}-${b.bill_period_month}`)).toEqual(['2025-11', '2026-2']);
  });
});
