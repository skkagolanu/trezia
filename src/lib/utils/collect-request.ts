// UPI deep links + wa.me messages, no payment gateway). Kept separate from
// the UI so the message/link format is unit-tested independent of React.

export interface CollectRequestInput {
  societyName: string;
  flatNumber: string;
  residentName: string | null;
  amount: number;
  /** Count of unpaid months — v_dues_summary exposes a count, not month labels. */
  monthsOwed: number;
}

function formatINR(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

export function buildCollectMessage({ societyName, flatNumber, residentName, amount, monthsOwed }: CollectRequestInput): string {
  const greeting = residentName ? `Dear ${residentName},` : 'Dear Resident,';
  const monthsPhrase = monthsOwed === 1 ? '1 month' : `${monthsOwed} months`;
  return (
    `${greeting} this is a reminder from ${societyName} that Flat ${flatNumber} has ` +
    `₹${formatINR(amount)} pending maintenance (${monthsPhrase} outstanding). ` +
    `Please clear it at your earliest convenience. Thank you.`
  );
}

/** India-only convention matching the existing RowActions.tsx wa.me pattern (91 country code). */
export function buildWhatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/91${digits}?text=${encodeURIComponent(message)}`;
}

export interface UpiLinkInput {
  vpa: string | null;
  payeeName: string;
  amount: number;
  note: string;
}

/** UPI deep link (upi://pay) per NPCI spec. Returns null when no VPA is configured — the
 * treasurer hasn't set one under Settings, so there's nothing to link to. */
export function buildUpiLink({ vpa, payeeName, amount, note }: UpiLinkInput): string | null {
  if (!vpa) return null;
  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: amount.toFixed(2),
    cu: 'INR',
    tn: note,
  });
  return `upi://pay?${params}`;
}
