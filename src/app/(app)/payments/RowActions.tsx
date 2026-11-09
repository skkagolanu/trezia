'use client';

import VoidButton from '@/components/ui/VoidButton';
import { usePathname } from 'next/navigation';
import { societyApiPath } from '@/lib/society-path';

// One consistent action set for every record row, regardless of type:
// PDF · Email · WhatsApp · Void. Email/WhatsApp are prefilled mailto:/wa.me links
// that activate only when the resident has an email / phone on file (otherwise shown
// disabled, so the layout stays identical across all rows).
export default function RowActions({
  kind,
  id,
  receiptNumber,
  email,
  phone,
  residentName,
  period,
  amount,
  isVoided,
  onOptimisticVoid,
  onVoidFail,
}: {
  kind: 'payment' | 'levy';
  id: string;
  receiptNumber: string | null;
  email: string | null;
  phone: string | null;
  residentName: string;
  period: string;
  amount: number;
  isVoided: boolean;
  onOptimisticVoid: () => void;
  onVoidFail: () => void;
}) {
  const pathname = usePathname();
  if (isVoided) {
    return <span className="text-[var(--text-xs)] text-[var(--sf-label3)]">Voided</span>;
  }

  const pdfHref = societyApiPath(pathname, kind === 'levy' ? `/api/pdf/levy?id=${id}` : `/api/pdf/receipt?payment_id=${id}`);
  const amountStr = `₹${amount.toLocaleString('en-IN')}`;
  const subject = `Receipt for ${period}`;
  const message =
    `Dear ${residentName}, your payment of ${amountStr} for ${period} has been received.` +
    (receiptNumber ? ` Receipt No: ${receiptNumber}.` : '');
  const mailto = email ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` : null;
  const wa = phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(message)}` : null;

  const btn = 'rounded px-2 py-1 text-[var(--text-xs)] font-medium transition-colors';
  const disabled = `${btn} text-sf-label3 opacity-40 cursor-not-allowed`;

  return (
    <div className="flex items-center justify-end gap-0.5">
      <a href={pdfHref} target="_blank" rel="noopener noreferrer" className={`${btn} text-sf-blue hover:bg-sf-blue/[0.08]`}>PDF</a>

      {mailto
        ? <a data-society-write href={mailto} className={`${btn} text-sf-blue hover:bg-sf-blue/[0.08]`}>Email</a>
        : <span data-society-write className={disabled} title="No email on file">Email</span>}

      {wa
        ? <a data-society-write href={wa} target="_blank" rel="noopener noreferrer" className={`${btn} text-sf-green hover:bg-sf-green/[0.08]`}>WhatsApp</a>
        : <span data-society-write className={disabled} title="No phone on file">WhatsApp</span>}

      <VoidButton
        id={id}
        endpoint={kind === 'levy' ? `/api/levies/${id}` : '/api/payments'}
        method={kind === 'levy' ? 'DELETE' : undefined}
        onOptimisticVoid={onOptimisticVoid}
        onVoidFail={onVoidFail}
      />
    </div>
  );
}
