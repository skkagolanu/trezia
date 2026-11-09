import { BillGenerateSchema } from '@/lib/validation/schemas';

describe('BillGenerateSchema', () => {
  it('does not accept client dates as authoritative fields', () => {
    const parsed = BillGenerateSchema.parse({
      bill_period_year: 2026,
      bill_period_month: 7,
      invoice_date: '2030-01-15',
      due_date: '2030-12-31',
      cgst_percent: 0,
      sgst_percent: 0,
      previous_due: 0,
      penalty_amount: 0,
    });

    expect(parsed).not.toHaveProperty('invoice_date');
    expect(parsed).not.toHaveProperty('due_date');
  });
});
