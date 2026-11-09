import { MAX_PAYMENT_PROOF_BYTES, paymentProofFileError } from '@/lib/payments/proof';

describe('payment proof client boundary', () => {
  it('accepts JPEG and PNG files up to the shared server limit', () => {
    expect(paymentProofFileError({ type: 'image/jpeg', size: MAX_PAYMENT_PROOF_BYTES })).toBeNull();
    expect(paymentProofFileError({ type: 'image/png', size: 1 })).toBeNull();
  });

  it('rejects unsupported and oversized files before OCR allocates memory', () => {
    expect(paymentProofFileError({ type: 'image/heic', size: 1 })).toMatch(/HEIC/i);
    expect(paymentProofFileError({ type: 'application/pdf', size: 1 })).toMatch(/JPEG or PNG/i);
    expect(paymentProofFileError({
      type: 'image/png',
      size: MAX_PAYMENT_PROOF_BYTES + 1,
    })).toMatch(/4 MiB/i);
  });
});
