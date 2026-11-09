import { classifyRenewals } from '@/lib/operations/renewals';

describe('renewal classification', () => {
  it('includes overdue and upcoming dates in stable due-date order', () => {
    const rows = [{ id: 'b', due: '2026-08-01' }, { id: 'a', due: '2026-06-01' }];
    expect(classifyRenewals(rows, row => row.due, '2026-07-19')).toEqual([
      { id: 'a', due: '2026-06-01', due_date: '2026-06-01', due_status: 'OVERDUE' },
      { id: 'b', due: '2026-08-01', due_date: '2026-08-01', due_status: 'UPCOMING' },
    ]);
  });

  it('omits missing dates and enforces the result bound', () => {
    expect(classifyRenewals([{ id: 'a', due: null }, { id: 'b', due: '2026-01-01' }], row => row.due, '2026-07-19', 1)).toHaveLength(1);
  });
});
