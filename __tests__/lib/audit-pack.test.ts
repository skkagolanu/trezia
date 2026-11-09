import { computeIncomeExpenditure, computeBalanceSheetEquity } from '@/lib/utils/audit-pack';

describe('computeIncomeExpenditure', () => {
  it('sums accrued maintenance + cash-basis income against cash-basis expenditure', () => {
    const r = computeIncomeExpenditure({
      maintenanceAccrued: 100000,
      otherIncomeTotal: 5000,
      amcTotal: 20000,
      expenseTotal: 80000,
    });
    expect(r.totalIncome).toBe(125000);
    expect(r.totalExpenditure).toBe(80000);
    expect(r.surplusOrDeficit).toBe(45000);
  });

  it('reports a negative surplus (deficit) when expenditure exceeds income', () => {
    const r = computeIncomeExpenditure({
      maintenanceAccrued: 10000,
      otherIncomeTotal: 0,
      amcTotal: 0,
      expenseTotal: 15000,
    });
    expect(r.surplusOrDeficit).toBe(-5000);
  });

  it('zero income and zero expenditure nets to zero, not NaN', () => {
    const r = computeIncomeExpenditure({ maintenanceAccrued: 0, otherIncomeTotal: 0, amcTotal: 0, expenseTotal: 0 });
    expect(r.totalIncome).toBe(0);
    expect(r.surplusOrDeficit).toBe(0);
  });
});

describe('computeBalanceSheetEquity', () => {
  it('always balances: totalEquityAndLiabilities equals totalAssets', () => {
    const r = computeBalanceSheetEquity({ bankCash: 300000, receivables: 50000, corpusFund: 120000 });
    expect(r.totalAssets).toBe(350000);
    expect(r.totalLiabilities).toBe(0);
    expect(r.totalEquityAndLiabilities).toBe(r.totalAssets);
  });

  it('reserveAndSurplus absorbs whatever is left after Corpus', () => {
    const r = computeBalanceSheetEquity({ bankCash: 300000, receivables: 50000, corpusFund: 120000 });
    expect(r.reserveAndSurplus).toBe(230000);
  });

  it('still balances when Corpus exceeds total assets (reserveAndSurplus goes negative)', () => {
    const r = computeBalanceSheetEquity({ bankCash: 10000, receivables: 0, corpusFund: 50000 });
    expect(r.reserveAndSurplus).toBe(-40000);
    expect(r.totalEquityAndLiabilities).toBe(r.totalAssets);
  });

  it('zero everything still balances at zero', () => {
    const r = computeBalanceSheetEquity({ bankCash: 0, receivables: 0, corpusFund: 0 });
    expect(r.totalAssets).toBe(0);
    expect(r.totalEquityAndLiabilities).toBe(0);
  });
});
