import { TreasurerHandoverPatchSchema, TreasurerHandoverSchema } from '@/lib/validation/schemas';

describe('TreasurerHandoverSchema', () => {
  const valid = {
    handover_date: '2026-07-19',
    outgoing_treasurer: 'Outgoing Treasurer',
    incoming_treasurer: 'Incoming Treasurer',
    bank_balance: 125000,
    cash_in_hand: 2500,
    outstanding_receivables_note: null,
    notes: 'Records transferred.',
  };

  it('accepts a complete handover with optional nullable balances and notes', () => {
    expect(TreasurerHandoverSchema.safeParse(valid).success).toBe(true);
    expect(TreasurerHandoverSchema.safeParse({
      ...valid,
      bank_balance: null,
      cash_in_hand: null,
      outstanding_receivables_note: null,
      notes: null,
    }).success).toBe(true);
  });

  it('rejects negative balances and invalid dates', () => {
    expect(TreasurerHandoverSchema.safeParse({ ...valid, bank_balance: -1 }).success).toBe(false);
    expect(TreasurerHandoverSchema.safeParse({ ...valid, handover_date: '19/07/2026' }).success).toBe(false);
  });

  it('requires at least one valid field for a patch', () => {
    expect(TreasurerHandoverPatchSchema.safeParse({ notes: 'Updated' }).success).toBe(true);
    expect(TreasurerHandoverPatchSchema.safeParse({}).success).toBe(false);
  });
});
