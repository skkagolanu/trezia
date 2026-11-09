import {
  computeStatement,
  countInRange,
  inRange,
  isDueAsOn,
  sumByCategory,
  sumInRange,
  unpaidBillStatusAsOn,
  undatedTotal,
  type DatedAmount,
  type SnapshotPoint,
} from '@/lib/utils/balance';

const D = (date: string | null, amount: number): DatedAmount => ({ date, amount });

describe('inRange', () => {
  it('bounds are inclusive',        () => {
    expect(inRange('2026-04-01', '2026-04-01', '2026-04-30')).toBe(true);
    expect(inRange('2026-04-30', '2026-04-01', '2026-04-30')).toBe(true);
  });
  it('outside bounds excluded',     () => {
    expect(inRange('2026-03-31', '2026-04-01', '2026-04-30')).toBe(false);
    expect(inRange('2026-05-01', '2026-04-01', '2026-04-30')).toBe(false);
  });
  it('open bounds are unbounded',   () => {
    expect(inRange('1999-01-01', undefined, '2026-04-30')).toBe(true);
    expect(inRange('2999-01-01', '2026-04-01', undefined)).toBe(true);
    expect(inRange('2026-01-01')).toBe(true);
  });
  it('null date never matches',     () => expect(inRange(null)).toBe(false));
});

describe('sumInRange / countInRange / undatedTotal', () => {
  const rows = [D('2026-04-05', 100), D('2026-05-05', 200), D(null, 50)];
  it('sums only in-range dated rows', () => expect(sumInRange(rows, '2026-04-01', '2026-04-30')).toBe(100));
  it('unbounded sum still skips undated rows', () => expect(sumInRange(rows)).toBe(300));
  it('counts in-range rows',          () => expect(countInRange(rows, '2026-04-01', '2026-05-31')).toBe(2));
  it('undatedTotal picks up the rest', () => expect(undatedTotal(rows)).toBe(50));
});

describe('sumByCategory', () => {
  it('groups, filters by range, sorts descending', () => {
    const rows = [
      { date: '2026-04-01', amount: 100, category: 'ELECTRICITY' },
      { date: '2026-04-02', amount: 900, category: 'WATCHMAN_SALARY' },
      { date: '2026-04-03', amount: 50, category: 'ELECTRICITY' },
      { date: '2026-09-01', amount: 999, category: 'LEGAL' }, // outside range
    ];
    expect(sumByCategory(rows, '2026-04-01', '2026-04-30')).toEqual([
      { category: 'WATCHMAN_SALARY', total: 900 },
      { category: 'ELECTRICITY', total: 150 },
    ]);
  });
});

describe('isDueAsOn (stored bill deadline)', () => {
  const asOn = '2026-07-07';
  it('OVERDUE always counts',               () => expect(isDueAsOn({ status: 'OVERDUE', due_date: '2026-08-07' }, asOn)).toBe(true));
  it('ISSUED before its deadline does not',  () => expect(isDueAsOn({ status: 'ISSUED', due_date: '2026-07-08' }, asOn)).toBe(false));
  it('ISSUED on its deadline does not',      () => expect(isDueAsOn({ status: 'ISSUED', due_date: '2026-07-07' }, asOn)).toBe(false));
  it('ISSUED after its deadline counts',     () => expect(isDueAsOn({ status: 'ISSUED', due_date: '2026-07-06' }, asOn)).toBe(true));
  it('PAID never counts',                    () => expect(isDueAsOn({ status: 'PAID', due_date: '2026-07-01' }, asOn)).toBe(false));
});

describe('unpaidBillStatusAsOn (current-month billing)', () => {
  const asOn = '2026-07-15';
  it('restores a past month as OVERDUE', () => expect(unpaidBillStatusAsOn(2026, 6, asOn)).toBe('OVERDUE'));
  it('restores the current month as ISSUED', () => expect(unpaidBillStatusAsOn(2026, 7, asOn)).toBe('ISSUED'));
  it('restores a future month as ISSUED', () => expect(unpaidBillStatusAsOn(2026, 8, asOn)).toBe('ISSUED'));
});

describe('computeStatement', () => {
  const snapshots: SnapshotPoint[] = [
    { date: '2026-03-31', total: 10000 },
    { date: '2026-05-31', total: 12000 },
  ];
  const receipts = [D('2026-04-10', 2000), D('2026-05-10', 3000), D('2026-06-10', 1000)];
  const payments = [D('2026-04-20', 500), D('2026-06-20', 700)];

  it('anchors opening on the latest snapshot before `from`', () => {
    const s = computeStatement({ from: '2026-04-01', to: '2026-06-30', snapshots, receipts, payments });
    expect(s.opening).toEqual({ amount: 10000, anchorDate: '2026-03-31' });
    expect(s.receiptsTotal).toBe(6000);
    expect(s.paymentsTotal).toBe(1200);
    expect(s.net).toBe(4800);
    expect(s.closing).toBe(14800);
  });

  it('rolls the anchor forward across the gap before `from`', () => {
    // Anchor is 31 Mar; period starts 1 May → April's +2000/−500 roll into opening.
    const s = computeStatement({ from: '2026-05-01', to: '2026-06-30', snapshots, receipts, payments });
    expect(s.opening).toEqual({ amount: 11500, anchorDate: '2026-03-31' });
    expect(s.net).toBe(3300); // 3000 + 1000 − 700
    expect(s.closing).toBe(14800);
  });

  it('a snapshot dated exactly `from` is not the anchor', () => {
    const s = computeStatement({
      from: '2026-05-31',
      to: '2026-06-30',
      snapshots,
      receipts,
      payments,
    });
    // Anchor falls back to 31 Mar and rolls forward through 30 May.
    expect(s.opening.anchorDate).toBe('2026-03-31');
    expect(s.opening.amount).toBe(10000 + 2000 + 3000 - 500);
  });

  it('reconciles against the latest in-period snapshot', () => {
    const s = computeStatement({ from: '2026-04-01', to: '2026-06-30', snapshots, receipts, payments });
    // Computed at 31 May: 10000 + (2000+3000) − 500 = 14500; recorded 12000.
    expect(s.reconciliation).toEqual({
      snapshotDate: '2026-05-31',
      recorded: 12000,
      computed: 14500,
      difference: -2500,
    });
  });

  it('no snapshot before `from` → opening and closing unknown', () => {
    const s = computeStatement({ from: '2026-01-01', to: '2026-02-28', snapshots, receipts, payments });
    expect(s.opening).toEqual({ amount: null, anchorDate: null });
    expect(s.closing).toBeNull();
    expect(s.reconciliation).toBeNull();
  });

  it('all-time (no from) → opening unknown, totals still computed', () => {
    const s = computeStatement({ snapshots, receipts, payments });
    expect(s.opening.amount).toBeNull();
    expect(s.receiptsTotal).toBe(6000);
    expect(s.paymentsTotal).toBe(1200);
    expect(s.closing).toBeNull();
  });

  it('undated receipts are excluded from every total', () => {
    const s = computeStatement({
      from: '2026-04-01',
      to: '2026-06-30',
      snapshots,
      receipts: [...receipts, D(null, 99999)],
      payments,
    });
    expect(s.receiptsTotal).toBe(6000);
  });
});
