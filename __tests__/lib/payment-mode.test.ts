import { PaymentSchema } from '@/lib/validation/schemas';

const VALID: Record<string, unknown> = {
  unit_id:        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  amount_paid:    2000,
  payment_mode:   'UPI',
  payment_date:   '2026-06-01',
  months_covered: 1,
};

describe('PaymentSchema validation', () => {
  it('accepts a valid payment', () => {
    expect(PaymentSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects negative amount', () => {
    const r = PaymentSchema.safeParse({ ...VALID, amount_paid: -100 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.amount_paid).toBeDefined();
  });

  it('rejects amount over 500,000', () => {
    const r = PaymentSchema.safeParse({ ...VALID, amount_paid: 600_000 });
    expect(r.success).toBe(false);
  });

  it('rejects zero amount', () => {
    const r = PaymentSchema.safeParse({ ...VALID, amount_paid: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects invalid payment_mode', () => {
    const r = PaymentSchema.safeParse({ ...VALID, payment_mode: 'BITCOIN' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid date format', () => {
    const r = PaymentSchema.safeParse({ ...VALID, payment_date: '01-06-2026' });
    expect(r.success).toBe(false);
  });

  it('rejects months_covered > 24', () => {
    const r = PaymentSchema.safeParse({ ...VALID, months_covered: 25 });
    expect(r.success).toBe(false);
  });

  it('accepts all valid payment modes', () => {
    const modes = ['UPI','MANUAL_COLLECTION','BANK_TRANSFER','OTHER'];
    for (const mode of modes) {
      expect(PaymentSchema.safeParse({ ...VALID, payment_mode: mode }).success).toBe(true);
    }
  });

  it('accepts optional utr_reference', () => {
    expect(PaymentSchema.safeParse({ ...VALID, utr_reference: 'UTR123' }).success).toBe(true);
    expect(PaymentSchema.safeParse({ ...VALID }).success).toBe(true);
  });

  it('coerces a numeric string amount (e.g. a non-JS API caller)', () => {
    const r = PaymentSchema.safeParse({ ...VALID, amount_paid: '2000' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount_paid).toBe(2000);
  });

  it('still reports the custom required_error when amount_paid is missing', () => {
    const withoutAmount = Object.fromEntries(Object.entries(VALID).filter(([k]) => k !== 'amount_paid'));
    const r = PaymentSchema.safeParse(withoutAmount);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.amount_paid?.[0]).toBe('Amount is required');
  });
});
