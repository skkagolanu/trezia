export const MAX_PAYMENT_PROOF_BYTES = 4 * 1024 * 1024;

export function paymentProofFileError(file: { type: string; size: number }): string | null {
  if (file.type === 'image/heic' || file.type === 'image/heif') {
    return 'HEIC photos are not supported. Please share or export the screenshot as JPEG or PNG, then try again.';
  }
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
    return 'Upload a JPEG or PNG screenshot.';
  }
  if (file.size > MAX_PAYMENT_PROOF_BYTES) {
    return 'Choose a JPEG or PNG screenshot no larger than 4 MiB.';
  }
  return null;
}
