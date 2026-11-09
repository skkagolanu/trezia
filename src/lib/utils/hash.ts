import { createHash } from 'crypto';

interface PaymentHashInput {
  unit_id: string;
  amount_paid: number;
  payment_date: string;
  utr_reference?: string | null;
  payment_mode: string;
  row_hash?: string | null;
}

export function computePaymentHash(payment: Omit<PaymentHashInput, 'row_hash'>): string {
  const data =
    payment.unit_id        + '|' +
    payment.amount_paid    + '|' +
    payment.payment_date   + '|' +
    (payment.utr_reference ?? '') + '|' +
    payment.payment_mode;
  return createHash('sha256').update(data).digest('hex');
}

export function verifyPaymentHash(payment: PaymentHashInput): boolean {
  if (!payment.row_hash) return false;
  const expected = computePaymentHash(payment);
  return expected === payment.row_hash;
}
