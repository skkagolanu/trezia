// Pure builders for the two DPDP data-principal requests a resident can make
// withdrawal. Deliberately request-based, not self-service writes — residents
// have no write path anywhere in the app  and there's no per-resident login
// mapping to safely gate a direct consent_given toggle (profiles.unit_id
// scopes a login to a flat, which can hold multiple residents). Routing the
// request through the treasurer via the existing zero-fee wa.me rail — same
// pattern as collect-request.ts — satisfies the DPDP requirement (a way to
// exercise the right) without a new write path or CSRF surface.

export interface PrivacyRequestInput {
  societyName: string;
  flatNumber: string;
}

export function buildDataAccessRequestMessage({ societyName, flatNumber }: PrivacyRequestInput): string {
  return (
    `Hi, I am a resident of Flat ${flatNumber} at ${societyName}. ` +
    `Under the DPDP Act 2023, I would like to request a copy of the personal data ` +
    `(name, contact details, payment history) held for my flat. Thank you.`
  );
}

export function buildConsentWithdrawalMessage({ societyName, flatNumber }: PrivacyRequestInput): string {
  return (
    `Hi, I am a resident of Flat ${flatNumber} at ${societyName}. ` +
    `I would like to withdraw my consent for email/WhatsApp notifications ` +
    `(receipts, bills, reminders) under the DPDP Act 2023. Please update my ` +
    `notification preference. Thank you.`
  );
}
