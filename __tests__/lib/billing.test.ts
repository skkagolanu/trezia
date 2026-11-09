import {
  addBillingDays,
  automaticPenalty,
  billingDatesForPeriod,
  isBillDue,
  outstandingAmount,
  summariseDues,
  isPayableBillStatus,
  PAYABLE_BILL_STATUSES,
  missingBilledUnitIds,
  overdueBillUpdate,
} from '@/lib/utils/billing';

describe('billing lifecycle', () => {
  it('keeps a seven-day window due through the seventh', () => {
    expect(addBillingDays('2026-07-01', 7)).toBe('2026-07-07');
    expect(billingDatesForPeriod(2026, 7, 7)).toEqual({
      invoiceDate: '2026-07-01',
      dueDate: '2026-07-07',
    });
  });

  it('handles year rollover and a zero-day window', () => {
    expect(addBillingDays('2026-12-29', 7)).toBe('2027-01-04');
    expect(addBillingDays('2026-07-01', 0)).toBe('2026-07-01');
  });

  it('does not treat the due date itself as overdue', () => {
    const bill = { status: 'ISSUED', due_date: '2026-07-07' };
    expect(isBillDue(bill, '2026-07-07')).toBe(false);
    expect(isBillDue(bill, '2026-07-08')).toBe(true);
  });

  it('calculates a one-time percentage of base maintenance', () => {
    expect(automaticPenalty(2_000, 2.5)).toBe(50);
  });

  it('preserves a manual penalty when transitioning to overdue', () => {
    expect(overdueBillUpdate({
      status: 'ISSUED', due_date: '2026-07-07', base_amount: 2_000, penalty_amount: 75,
    }, 2.5, '2026-07-08')).toEqual({ status: 'OVERDUE', penalty_amount: 75 });
  });

  it('does not change paid or not-yet-due bills', () => {
    expect(overdueBillUpdate({
      status: 'PAID', due_date: '2026-07-01', base_amount: 2_000, penalty_amount: 0,
    }, 2, '2026-07-08')).toBeNull();
    expect(overdueBillUpdate({
      status: 'ISSUED', due_date: '2026-07-08', base_amount: 2_000, penalty_amount: 0,
    }, 2, '2026-07-08')).toBeNull();
  });

  it('finds active flats without a current-month bill', () => {
    expect(missingBilledUnitIds(['101', '102', '103'], ['101', '103'])).toEqual(['102']);
    expect(missingBilledUnitIds(['101'], ['101'])).toEqual([]);
  });

  describe('outstandingAmount', () => {
    it('nets the settled amount off what the bill still owes', () => {
      expect(outstandingAmount({ payable_amount: 2_000, amount_settled: 500 })).toBe(1_500);
      expect(outstandingAmount({ payable_amount: 2_000, amount_settled: 0 })).toBe(2_000);
    });

    it('reads PostgREST numeric strings as numbers', () => {
      expect(outstandingAmount({ payable_amount: '2040.50', amount_settled: '40.50' })).toBe(2_000);
    });

    it('never goes negative, so an overpaid bill cannot credit a dues total', () => {
      expect(outstandingAmount({ payable_amount: 2_000, amount_settled: 2_500 })).toBe(0);
      expect(outstandingAmount({ payable_amount: 2_000, amount_settled: 2_000 })).toBe(0);
    });

    it('rounds to paise rather than leaving binary float dust', () => {
      expect(outstandingAmount({ payable_amount: 0.3, amount_settled: 0.1 })).toBe(0.2);
    });
  });

  describe('summariseDues', () => {
    const bill = (year: number, month: number, over: Partial<{ status: string; payable_amount: number; amount_settled: number }> = {}) => ({
      id: `${year}-${month}`,
      status: 'OVERDUE',
      due_date: `${year}-${String(month).padStart(2, '0')}-10`,
      payable_amount: 2_000,
      amount_settled: 0,
      ...over,
    });

    it('counts arrears older than the twelve most recent months', () => {
      // The resident page read only the newest 12 bills, so months 13+ were
      // dropped from the headline, the UPI amount and the proof-form choices.
      const eighteenMonths = Array.from({ length: 18 }, (_, i) => bill(2025, 1 + (i % 12)))
        .map((b, i) => ({ ...b, id: `b${i}`, due_date: `2025-01-10` }));

      const dues = summariseDues(eighteenMonths, '2026-08-23');

      expect(dues.payable).toHaveLength(18);
      expect(dues.totalDue).toBe(36_000);
    });

    it('nets part settlement off the total rather than re-billing it', () => {
      const dues = summariseDues([bill(2025, 1, { amount_settled: 500 })], '2026-08-23');
      expect(dues.totalDue).toBe(1_500);
      expect(dues.totalPayable).toBe(1_500);
    });

    it('drops paid and fully settled bills entirely', () => {
      const dues = summariseDues([
        bill(2025, 1, { status: 'PAID', amount_settled: 2_000 }),
        bill(2025, 2, { amount_settled: 2_000 }),
      ], '2026-08-23');
      expect(dues.payable).toHaveLength(0);
      expect(dues.totalPayable).toBe(0);
    });

    it('separates what is late from what is payable but not yet due', () => {
      const dues = summariseDues([
        bill(2025, 1),
        { ...bill(2026, 12), status: 'ISSUED', due_date: '2026-12-10' },
      ], '2026-08-23');

      expect(dues.overdue).toHaveLength(1);
      expect(dues.totalDue).toBe(2_000);
      expect(dues.payable).toHaveLength(2);
      expect(dues.totalPayable).toBe(4_000);
    });
  });

  describe('payable bill statuses', () => {
    it('treats only ISSUED and OVERDUE as owed', () => {
      expect([...PAYABLE_BILL_STATUSES]).toEqual(['ISSUED', 'OVERDUE']);
      expect(isPayableBillStatus('ISSUED')).toBe(true);
      expect(isPayableBillStatus('OVERDUE')).toBe(true);
    });

    it('excludes DRAFT and CANCELLED, which "not PAID" wrongly admitted', () => {

      expect(isPayableBillStatus('DRAFT')).toBe(false);
      expect(isPayableBillStatus('CANCELLED')).toBe(false);
      expect(isPayableBillStatus('PAID')).toBe(false);
    });

    it('keeps draft and cancelled months out of a resident’s dues total', () => {
      const dues = summariseDues([
        { status: 'OVERDUE', due_date: '2025-01-10', payable_amount: 2_000, amount_settled: 0 },
        { status: 'DRAFT', due_date: '2025-02-10', payable_amount: 2_000, amount_settled: 0 },
        { status: 'CANCELLED', due_date: '2025-03-10', payable_amount: 2_000, amount_settled: 0 },
      ], '2026-08-23');

      expect(dues.payable).toHaveLength(1);
      expect(dues.totalPayable).toBe(2_000);
      expect(dues.totalDue).toBe(2_000);
    });
  });
});
