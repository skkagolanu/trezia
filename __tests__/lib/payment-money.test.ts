import { isWholePaise, paiseToRupees, parseRupeesToPaise } from '@/lib/payments/money';

describe('payment money parsing', () => {
  it.each([
    ['0.01', 1],
    ['14', 1400],
    ['14000.6', 1_400_060],
    ['500000.00', 50_000_000],
  ])('parses %s as integer paise', (raw, expected) => {
    expect(parseRupeesToPaise(raw)).toBe(expected);
  });

  it.each(['', '0', '-1', '1.001', '1e3', '500000.01', 'NaN', 'Infinity'])('rejects %s', raw => {
    expect(parseRupeesToPaise(raw)).toBeNull();
  });

  it('converts only integer paise back to rupees', () => {
    expect(paiseToRupees(1_400_060)).toBe(14_000.6);
    expect(() => paiseToRupees(1.5)).toThrow('integer paise');
  });

  it('recognizes whole-paise JSON numbers without rejecting normal decimals', () => {
    expect(isWholePaise(14_000.6)).toBe(true);
    expect(isWholePaise(1.001)).toBe(false);
  });
});
