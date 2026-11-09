import { PaymentSchema, ExpenseSchema, VoidSchema } from '@/lib/validation/schemas';


const VALID_PAYMENT = {
  unit_id:        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  amount_paid:    2000,
  payment_mode:   'UPI' as const,
  payment_date:   '2026-06-01',
  months_covered: 1,
};

describe('POST /api/payments — input validation', () => {
  it('rejects negative amount', () => {
    const r = PaymentSchema.safeParse({ ...VALID_PAYMENT, amount_paid: -100 });
    expect(r.success).toBe(false);
  });

  it('rejects amount over 500,000', () => {
    const r = PaymentSchema.safeParse({ ...VALID_PAYMENT, amount_paid: 999_999 });
    expect(r.success).toBe(false);
  });

  it('rejects missing unit_id', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { unit_id: _omit, ...rest } = VALID_PAYMENT;
    const r = PaymentSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('rejects invalid UUID for unit_id', () => {
    const r = PaymentSchema.safeParse({ ...VALID_PAYMENT, unit_id: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid payment_mode', () => {
    const r = PaymentSchema.safeParse({ ...VALID_PAYMENT, payment_mode: 'INVALID' });
    expect(r.success).toBe(false);
  });

  it('rejects months_covered = 0', () => {
    const r = PaymentSchema.safeParse({ ...VALID_PAYMENT, months_covered: 0 });
    expect(r.success).toBe(false);
  });

  it('accepts all 4 payment modes', () => {
    const modes = ['UPI','MANUAL_COLLECTION','BANK_TRANSFER','OTHER'];
    for (const mode of modes) {
      expect(PaymentSchema.safeParse({ ...VALID_PAYMENT, payment_mode: mode }).success).toBe(true);
    }
  });

  it('accepts valid optional fields', () => {
    const r = PaymentSchema.safeParse({
      ...VALID_PAYMENT,
      utr_reference:  'UTR123456',
      collector_name: 'Ram',
      notes:          'Paid via NB portal',
      months_detail:  'Jun 2026',
    });
    expect(r.success).toBe(true);
  });
});

describe('VoidSchema validation', () => {
  it('rejects void_reason shorter than 10 chars', () => {
    const r = VoidSchema.safeParse({ id: VALID_PAYMENT.unit_id, void_reason: 'too short' });
    expect(r.success).toBe(false);
  });

  it('accepts valid void request', () => {
    const r = VoidSchema.safeParse({
      id:          VALID_PAYMENT.unit_id,
      void_reason: 'Duplicate entry — resident paid twice by mistake',
    });
    expect(r.success).toBe(true);
  });
});

describe('ExpenseSchema validation', () => {
  const VALID_EXPENSE = {
    expense_date: '2026-06-01',
    category:     'ELECTRICITY' as const,
    description:  'June electricity bill',
    amount:       4500,
  };

  it('accepts a valid expense', () => {
    expect(ExpenseSchema.safeParse(VALID_EXPENSE).success).toBe(true);
  });

  it('rejects negative amount', () => {
    expect(ExpenseSchema.safeParse({ ...VALID_EXPENSE, amount: -1 }).success).toBe(false);
  });

  it('rejects description shorter than 2 chars', () => {
    expect(ExpenseSchema.safeParse({ ...VALID_EXPENSE, description: 'x' }).success).toBe(false);
  });
});
