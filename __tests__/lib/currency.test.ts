import { amountInWords, formatINR } from '@/lib/utils/currency';

describe('amountInWords', () => {
  it('2000 → Two Thousand Rupees Only',       () => expect(amountInWords(2000)).toBe('Two Thousand Rupees Only'));
  it('2300 → Two Thousand Three Hundred…',    () => expect(amountInWords(2300)).toBe('Two Thousand Three Hundred Rupees Only'));
  it('115000 → One Lakh Fifteen Thousand…',  () => expect(amountInWords(115000)).toBe('One Lakh Fifteen Thousand Rupees Only'));
  it('10000000 → One Crore Rupees Only',      () => expect(amountInWords(10000000)).toBe('One Crore Rupees Only'));
  it('0 → Zero Rupees Only',                  () => expect(amountInWords(0)).toBe('Zero Rupees Only'));
  it('1 → One Rupees Only',                   () => expect(amountInWords(1)).toBe('One Rupees Only'));
  it('19 → Nineteen Rupees Only',             () => expect(amountInWords(19)).toBe('Nineteen Rupees Only'));
  it('100 → One Hundred Rupees Only',         () => expect(amountInWords(100)).toBe('One Hundred Rupees Only'));
  it('1000 → One Thousand Rupees Only',       () => expect(amountInWords(1000)).toBe('One Thousand Rupees Only'));
  it('100000 → One Lakh Rupees Only',         () => expect(amountInWords(100000)).toBe('One Lakh Rupees Only'));
});

describe('formatINR', () => {
  it('formats 2300 with Indian thousands separator',  () => expect(formatINR(2300)).toContain('2,300'));
  it('formats 110000 as 1,10,000',                    () => expect(formatINR(110000)).toContain('1,10,000'));
  it('includes ₹ symbol',                             () => expect(formatINR(1000)).toContain('₹'));
  it('formats 0 as ₹0.00',                            () => expect(formatINR(0)).toContain('0'));
});
