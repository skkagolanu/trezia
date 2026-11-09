import {
  allocate,
  allocateDirected,
  outstandingOn,
  totalApplied,
  DEFAULT_APPROPRIATION_POLICY,
  type AppropriableBill,
} from '@/lib/utils/appropriation';

function bill(overrides: Partial<AppropriableBill> & { id: string; month: number }): AppropriableBill {
  const { month, ...rest } = overrides;
  return {
    bill_period_year: 2026,
    bill_period_month: month,
    payable_amount: 1000,
    amount_settled: 0,
    penalty_amount: 0,
    ...rest,
  };
}

// Jan, Feb, Mar at 1000 each — the owner's worked example scaled down.
const JAN = bill({ id: 'jan', month: 1 });
const FEB = bill({ id: 'feb', month: 2 });
const MAR = bill({ id: 'mar', month: 3 });

describe('appropriation — s.61 default (oldest first)', () => {
  it('backfills the oldest dues first rather than the newest', () => {
    const result = allocate([MAR, JAN, FEB], 1500);

    // Deliberately passed newest-first to prove the input order does not matter.
    expect(result.perBill.map(b => b.bill_id)).toEqual(['jan', 'feb']);
    expect(result.perBill[0].applied).toBe(1000);
    expect(result.perBill[1].applied).toBe(500);
    expect(result.unapplied).toBe(0);
  });

  it('settles bills exactly when the amount fits', () => {
    const result = allocate([JAN, FEB], 2000);

    expect(result.perBill.every(b => b.settles_bill)).toBe(true);
    expect(result.unapplied).toBe(0);
  });

  it('marks a partially covered bill as not settled', () => {
    const result = allocate([JAN], 400);

    expect(result.perBill[0].applied).toBe(400);
    expect(result.perBill[0].settles_bill).toBe(false);
  });

  it('leaves the remainder unapplied when the payment exceeds all dues', () => {
    const result = allocate([JAN, FEB], 2500);

    expect(totalApplied(result)).toBe(2000);
    expect(result.unapplied).toBe(500);
  });

  it('treats a payment with no outstanding bills as entirely unapplied', () => {
    const result = allocate([], 3000);

    expect(result.perBill).toEqual([]);
    expect(result.unapplied).toBe(3000);
  });

  it('skips bills already fully settled', () => {
    const paid = bill({ id: 'paid', month: 1, amount_settled: 1000 });
    const result = allocate([paid, FEB], 1000);

    expect(result.perBill.map(b => b.bill_id)).toEqual(['feb']);
  });

  it('accounts for part-settled bills rather than re-charging the full amount', () => {
    const partly = bill({ id: 'partly', month: 1, amount_settled: 600 });
    const result = allocate([partly], 1000);

    expect(result.perBill[0].applied).toBe(400);
    expect(result.perBill[0].settles_bill).toBe(true);
    expect(result.unapplied).toBe(600);
  });

  it('orders across a year boundary by year before month', () => {
    const decLastYear = bill({ id: 'dec', month: 12 });
    decLastYear.bill_period_year = 2025;
    const result = allocate([JAN, decLastYear], 1000);

    expect(result.perBill[0].bill_id).toBe('dec');
  });
});

describe('appropriation — principal before penalty', () => {
  it('consumes the principal portion before the penalty portion', () => {
    // 1200 payable = 1000 principal + 200 penalty.
    const withPenalty = bill({ id: 'pen', month: 1, payable_amount: 1200, penalty_amount: 200 });
    const result = allocate([withPenalty], 1000);

    expect(result.perBill[0].applied_to_principal).toBe(1000);
    expect(result.perBill[0].applied_to_penalty).toBe(0);
  });

  it('reaches the penalty only once the principal is covered', () => {
    const withPenalty = bill({ id: 'pen', month: 1, payable_amount: 1200, penalty_amount: 200 });
    const result = allocate([withPenalty], 1150);

    expect(result.perBill[0].applied_to_principal).toBe(1000);
    expect(result.perBill[0].applied_to_penalty).toBe(150);
    expect(result.perBill[0].settles_bill).toBe(false);
  });

  it('splits a full settlement across both components', () => {
    const withPenalty = bill({ id: 'pen', month: 1, payable_amount: 1200, penalty_amount: 200 });
    const result = allocate([withPenalty], 1200);

    expect(result.perBill[0].applied_to_principal).toBe(1000);
    expect(result.perBill[0].applied_to_penalty).toBe(200);
    expect(result.perBill[0].settles_bill).toBe(true);
  });
});

describe('appropriation — s.59 resident direction', () => {
  it('honours the chosen months even when an older bill is outstanding', () => {
    const result = allocateDirected([JAN, FEB, MAR], ['mar'], 1000);

    // Jan is older and unpaid, but the payer directed this at March.
    expect(result.perBill.map(b => b.bill_id)).toEqual(['mar']);
    expect(result.unapplied).toBe(0);
  });

  it('does not spill surplus onto months the payer did not choose', () => {
    const result = allocateDirected([JAN, FEB, MAR], ['mar'], 1500);

    expect(result.perBill.map(b => b.bill_id)).toEqual(['mar']);
    expect(result.unapplied).toBe(500);
  });

  it('still applies oldest-first among the directed subset', () => {
    const result = allocateDirected([JAN, FEB, MAR], ['mar', 'feb'], 1200);

    expect(result.perBill.map(b => b.bill_id)).toEqual(['feb', 'mar']);
  });

  it('treats an empty direction as a pure advance', () => {
    const result = allocateDirected([JAN, FEB], [], 800);

    expect(result.perBill).toEqual([]);
    expect(result.unapplied).toBe(800);
  });
});

describe('appropriation — invariants', () => {
  it('never creates or destroys money', () => {
    const cases: Array<[AppropriableBill[], number]> = [
      [[JAN, FEB, MAR], 1500],
      [[JAN], 0],
      [[JAN, FEB], 2500],
      [[bill({ id: 'p', month: 1, payable_amount: 1200, penalty_amount: 200 })], 1150],
      [[bill({ id: 'odd', month: 1, payable_amount: 1033.33 })], 500.01],
      [[], 99.99],
    ];

    for (const [bills, amount] of cases) {
      const result = allocate(bills, amount);
      expect(totalApplied(result) + result.unapplied).toBeCloseTo(amount, 2);
    }
  });

  it('splits each bill allocation exactly into principal and penalty', () => {
    const withPenalty = bill({ id: 'pen', month: 1, payable_amount: 1200, penalty_amount: 200 });
    for (const amount of [1, 500, 1000, 1001, 1199, 1200]) {
      const [allocation] = allocate([withPenalty], amount).perBill;
      expect(allocation.applied_to_principal + allocation.applied_to_penalty).toBeCloseTo(allocation.applied, 2);
    }
  });

  it('never applies more than a bill outstanding', () => {
    const result = allocate([JAN, FEB, MAR], 99999);

    for (const allocation of result.perBill) {
      expect(allocation.applied).toBeLessThanOrEqual(1000);
    }
  });

  it('ignores a negative payment rather than crediting backwards', () => {
    const result = allocate([JAN], -500);

    expect(result.perBill).toEqual([]);
    expect(result.unapplied).toBe(0);
  });

  it('never reports negative outstanding when settlement exceeds the bill', () => {
    const over = bill({ id: 'over', month: 1, payable_amount: 1000, amount_settled: 1200 });

    expect(outstandingOn(over)).toBe(0);
  });

  it('rejects an unknown policy rather than silently applying the default', () => {
    expect(() => allocate([JAN], 100, 'interest-first' as typeof DEFAULT_APPROPRIATION_POLICY))
      .toThrow(/Unsupported appropriation policy/);
  });
});
