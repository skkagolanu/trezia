import { computePaymentHash, verifyPaymentHash } from '@/lib/utils/hash';

const BASE = {
  unit_id:       'unit-uuid-123',
  amount_paid:   2000,
  payment_date:  '2026-06-01',
  utr_reference: 'UTR123456789',
  payment_mode:  'UPI',
};

describe('computePaymentHash', () => {
  it('returns a 64-char hex string (SHA-256)', () => {
    expect(computePaymentHash(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(computePaymentHash(BASE)).toBe(computePaymentHash(BASE));
  });

  it('changes when amount changes', () => {
    expect(computePaymentHash(BASE)).not.toBe(computePaymentHash({ ...BASE, amount_paid: 2001 }));
  });

  it('changes when unit_id changes', () => {
    expect(computePaymentHash(BASE)).not.toBe(computePaymentHash({ ...BASE, unit_id: 'other-uuid' }));
  });

  it('changes when payment_mode changes', () => {
    expect(computePaymentHash(BASE)).not.toBe(computePaymentHash({ ...BASE, payment_mode: 'CASH' }));
  });

  it('treats null utr_reference as empty string', () => {
    const withNull = computePaymentHash({ ...BASE, utr_reference: null });
    const withEmpty = computePaymentHash({ ...BASE, utr_reference: '' });
    expect(withNull).toBe(withEmpty);
  });
});

describe('verifyPaymentHash', () => {
  it('returns true for an untampered record', () => {
    const hash = computePaymentHash(BASE);
    expect(verifyPaymentHash({ ...BASE, row_hash: hash })).toBe(true);
  });

  it('returns false if amount was tampered', () => {
    const hash = computePaymentHash(BASE);
    expect(verifyPaymentHash({ ...BASE, amount_paid: 9999, row_hash: hash })).toBe(false);
  });

  it('returns false if row_hash is null', () => {
    expect(verifyPaymentHash({ ...BASE, row_hash: null })).toBe(false);
  });

  it('returns false if row_hash is empty string', () => {
    expect(verifyPaymentHash({ ...BASE, row_hash: '' })).toBe(false);
  });
});
