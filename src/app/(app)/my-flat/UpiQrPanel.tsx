import { societyPath } from '@/lib/society-path';

type Props = {
  slug: string | null;
};

// Native <details> keeps this a zero-JS disclosure — no client component,
// no CSP question, and the resident route stays as light as possible.
export default function UpiQrPanel({ slug }: Props) {
  return (
    <details className="rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3">
      <summary className="cursor-pointer text-[var(--text-sm)] font-medium text-[var(--sf-label)]">
        Show QR to pay
      </summary>
      <div className="mt-3 space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route; next/image's optimizer fetches server-side without the viewer's session cookies */}
        <img
          src={societyPath(slug, '/api/society/upi-qr')}
          alt="Society UPI payment QR code"
          width={240}
          height={240}
          className="max-w-[240px] rounded-[var(--radius-md)] border border-[var(--sf-border)]"
        />
        <p className="text-[var(--text-xs)] text-[var(--sf-label2)]">
          Enter the amount shown as due when your UPI app asks for it, then come back here and
          upload proof so the treasurer can record your payment.
        </p>
      </div>
    </details>
  );
}
