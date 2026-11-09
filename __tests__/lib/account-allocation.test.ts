import { allocateAccount, type AccountObligation } from '@/lib/utils/account-allocation';

const obligations: AccountObligation[] = [
  { id: 'levy-old', kind: 'levy', label: 'Lift repair levy', effectiveDate: '2026-06-01', outstanding: 3_000 },
  { id: 'bill-old', kind: 'maintenance', label: 'Jul 2026', effectiveDate: '2026-07-10', outstanding: 1_000 },
  { id: 'bill-new', kind: 'maintenance', label: 'Aug 2026', effectiveDate: '2026-08-10', outstanding: 1_000 },
];

describe('allocateAccount', () => {
  it('fills the oldest charge across levy and maintenance ledgers', () => {
    expect(allocateAccount(obligations, 3_500)).toEqual({
      allocations: [
        { obligationId: 'levy-old', kind: 'levy', label: 'Lift repair levy', applied: 3_000, settlesObligation: true },
        { obligationId: 'bill-old', kind: 'maintenance', label: 'Jul 2026', applied: 500, settlesObligation: false },
      ],
      unapplied: 0,
    });
  });

  it('keeps a genuine overpayment as account credit using paise arithmetic', () => {
    expect(allocateAccount(obligations, 5_000.01).unapplied).toBe(0.01);
  });

  it('does not mutate the caller order', () => {
    const ids = obligations.map(obligation => obligation.id);
    allocateAccount(obligations, 500);
    expect(obligations.map(obligation => obligation.id)).toEqual(ids);
  });

  it('rejects a caller that discards a ledger ordering guarantee', () => {
    expect(() => allocateAccount([
      { id: 'new', kind: 'maintenance', label: 'New', effectiveDate: '2026-08-01', outstanding: 1 },
      { id: 'old', kind: 'maintenance', label: 'Old', effectiveDate: '2026-07-01', outstanding: 1 },
    ], 1)).toThrow('Account maintenance obligations must be oldest first');
  });
});
