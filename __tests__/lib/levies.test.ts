import { aggregateLevyCollections, levyStatusFor, outstandingLevy } from '@/lib/utils/levies';

const collection = (
  id: string,
  unit_id: string,
  amount_paid: number,
  overrides: Partial<{ payment_date: string; created_at: string; is_voided: boolean }> = {},
) => ({ id, unit_id, amount_paid, payment_date: '2026-07-01', created_at: id, is_voided: false, ...overrides });

describe('aggregateLevyCollections', () => {
  it('sums multiple active collections and keeps the individual rows', () => {
    const result = aggregateLevyCollections([
      collection('1', 'flat-202', 855),
      collection('2', 'flat-202', 855, { payment_date: '2026-07-02' }),
    ], 1710).get('flat-202');

    expect(result?.total).toBe(1710);
    expect(result?.status).toBe('paid');
    expect(result?.latest?.id).toBe('2');
    expect(result?.collections).toHaveLength(2);
  });

  it('marks a non-zero underpayment as partial', () => {
    const result = aggregateLevyCollections([
      collection('1', 'flat-507', 855),
    ], 1710).get('flat-507');
    expect(result?.status).toBe('partial');
  });

  it('excludes voided collections', () => {
    const result = aggregateLevyCollections([
      collection('1', 'flat-504', 2300, { is_voided: true }),
      collection('2', 'flat-504', 1000),
    ], 2300).get('flat-504');
    expect(result?.total).toBe(1000);
    expect(result?.status).toBe('partial');
  });

  it('handles pending, partial and paid thresholds', () => {
    expect(levyStatusFor(0, 2500)).toBe('pending');
    expect(levyStatusFor(1, 2500)).toBe('partial');
    expect(levyStatusFor(2500, 2500)).toBe('paid');
    expect(levyStatusFor(3000, 2500)).toBe('paid');
  });
});

describe('outstandingLevy', () => {
  it('is the balance left on the assessment', () => {
    expect(outstandingLevy({ amount: 1_200, amount_settled: 500 })).toBe(700);
    expect(outstandingLevy({ amount: 1_200, amount_settled: 0 })).toBe(1_200);
  });

  it('reads PostgREST numeric strings', () => {
    expect(outstandingLevy({ amount: '1200.50', amount_settled: '200.50' })).toBe(1_000);
  });

  it('never goes negative on an over-settled assessment', () => {
    // A raw subtraction showed a negative balance on the resident's tile and
    // handed a negative amount to the payment form.
    expect(outstandingLevy({ amount: 1_200, amount_settled: 1_500 })).toBe(0);
    expect(outstandingLevy({ amount: 1_200, amount_settled: 1_200 })).toBe(0);
  });

  it('rounds to paise rather than leaving float dust', () => {
    expect(outstandingLevy({ amount: 0.3, amount_settled: 0.1 })).toBe(0.2);
  });
});
