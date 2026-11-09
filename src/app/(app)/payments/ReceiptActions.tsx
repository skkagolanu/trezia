'use client';
import { societyApiPath, societyFetch } from '@/lib/society-path';
import { usePathname } from 'next/navigation';

import { useState } from 'react';
import toast from 'react-hot-toast';

interface Props {
  paymentId: string;
  receiptNumber: string;
  hasStoredPdf: boolean;
  phone: string | null;
  residentName: string;
  monthsPeriod: string;
  amountPaid: number;
}

export default function ReceiptActions({
  paymentId,
  receiptNumber,
  hasStoredPdf: initialHasStoredPdf,
  phone,
  residentName,
  monthsPeriod,
  amountPaid,
}: Props) {
  const pathname = usePathname();
  const [hasStoredPdf, setHasStoredPdf] = useState(initialHasStoredPdf);
  const [generating, setGenerating] = useState(false);

  async function generate() {
    setGenerating(true);
    try {
      const res = await societyFetch('/api/pdf/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: paymentId }),
      });
      const data = await res.json() as { ok?: boolean; stored?: boolean; error?: string };
      if (data.ok) {
        setHasStoredPdf(data.stored === true);
        toast.success(data.stored ? 'Receipt generated and stored' : 'Receipt generated');
      } else {
        toast.error(data.error ?? 'Failed');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setGenerating(false);
    }
  }

  function viewPdf() {
    window.open(societyApiPath(pathname, `/api/pdf/receipt?payment_id=${paymentId}`), '_blank');
  }

  function whatsapp() {
    if (!phone) return;
    const msg = encodeURIComponent(
      `Dear ${residentName}, receipt for ${monthsPeriod} ₹${amountPaid.toLocaleString('en-IN')} is ready. ` +
      `Receipt No: ${receiptNumber}.`
    );
    window.open(`https://wa.me/91${phone}?text=${msg}`, '_blank');
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={viewPdf}
        title="View / print PDF"
        className="rounded px-2 py-1 text-[var(--text-xs)] font-medium text-sf-blue hover:bg-sf-blue/[0.08] transition-colors"
      >
        PDF
      </button>

      {!hasStoredPdf && (
        <button
          data-society-write
          onClick={generate}
          disabled={generating}
          title="Generate & store PDF"
          className="rounded px-2 py-1 text-[var(--text-xs)] font-medium text-sf-label2 hover:bg-black/[0.06] transition-colors disabled:opacity-50"
        >
          {generating ? '...' : 'Store'}
        </button>
      )}

      {phone && (
        <button
          data-society-write
          onClick={whatsapp}
          title="Share via WhatsApp"
          className="rounded px-2 py-1 text-[var(--text-xs)] font-medium text-sf-green hover:bg-sf-green/[0.08] transition-colors"
        >
          WA
        </button>
      )}
    </div>
  );
}
