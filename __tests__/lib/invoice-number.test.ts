import { invoiceNumber } from '@/lib/billing/invoice-number';

describe('invoiceNumber', () => {
  it('formats MONTH/FLAT/YY and strips whitespace from the flat number', () => {
    expect(invoiceNumber('101', 2026, 8)).toBe('AUG/101/26');
    expect(invoiceNumber('A 12', 2026, 1)).toBe('JAN/A12/26');
  });

  it('covers every month abbreviation', () => {
    expect(invoiceNumber('1', 2099, 12)).toBe('DEC/1/99');
    expect(invoiceNumber('1', 2020, 1)).toBe('JAN/1/20');
  });
});
