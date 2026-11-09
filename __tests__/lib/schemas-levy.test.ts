import { LevySchema, LevyPatchSchema } from '@/lib/validation/schemas';

const VALID_LEVY = {
  unit_id:      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  levy_label:   'CMC-2025' as const,
  amount_paid:  2300,
  payment_mode: 'UPI' as const,
};

describe('LevySchema validation', () => {
  it('accepts a valid levy', () => {
    expect(LevySchema.safeParse(VALID_LEVY).success).toBe(true);
  });

  it('accepts a levy_label named in plain words', () => {

    for (const levy_label of ['FAKE-2099', 'Lift repair fund', 'AMC-2026', 'CMC-June-27']) {
      expect(LevySchema.safeParse({ ...VALID_LEVY, levy_label }).success).toBe(true);
    }
  });

  it('still rejects a levy_label that is empty, over-long or multi-line', () => {
    for (const levy_label of ['', '   ', 'x'.repeat(61), 'two\nlines']) {
      expect(LevySchema.safeParse({ ...VALID_LEVY, levy_label }).success).toBe(false);
    }
  });

  it('rejects negative amount', () => {
    const r = LevySchema.safeParse({ ...VALID_LEVY, amount_paid: -100 });
    expect(r.success).toBe(false);
  });

  it('rejects amount over 50,000', () => {
    const r = LevySchema.safeParse({ ...VALID_LEVY, amount_paid: 99_999 });
    expect(r.success).toBe(false);
  });

  it('rejects invalid unit_id', () => {
    const r = LevySchema.safeParse({ ...VALID_LEVY, unit_id: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });

  it('rejects missing unit_id', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { unit_id: _omit, ...rest } = VALID_LEVY;
    expect(LevySchema.safeParse(rest).success).toBe(false);
  });

  it('accepts optional payment_date', () => {
    const r = LevySchema.safeParse({ ...VALID_LEVY, payment_date: '2026-01-15' });
    expect(r.success).toBe(true);
  });

  it('rejects invalid payment_date', () => {
    const r = LevySchema.safeParse({ ...VALID_LEVY, payment_date: 'not-a-date' });
    expect(r.success).toBe(false);
  });

  it('accepts all 5 levy labels', () => {
    const labels = ['CMC-June-22', 'AMC-2023', 'CMC-2024', 'CMC-2025', 'AMC-2026'];
    for (const levy_label of labels) {
      expect(LevySchema.safeParse({ ...VALID_LEVY, levy_label }).success).toBe(true);
    }
  });

  it('defaults payment_mode to MANUAL_COLLECTION when omitted', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { payment_mode: _omit, ...rest } = VALID_LEVY;
    const r = LevySchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payment_mode).toBe('MANUAL_COLLECTION');
  });
});

describe('LevyPatchSchema validation', () => {
  it('accepts valid patch', () => {
    const r = LevyPatchSchema.safeParse({ amount_paid: 1500, payment_mode: 'MANUAL_COLLECTION' });
    expect(r.success).toBe(true);
  });

  it('rejects amount of zero', () => {
    expect(LevyPatchSchema.safeParse({ amount_paid: 0 }).success).toBe(false);
  });

  it('accepts null payment_date to clear the field', () => {
    const r = LevyPatchSchema.safeParse({ amount_paid: 2300, payment_date: null });
    expect(r.success).toBe(true);
  });
});
