'use client';

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import { paymentModeBadge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils/date';
import { formatINR } from '@/lib/utils/currency';
import { ArrowUpDown } from 'lucide-react';

type Payment = {
  id: string;
  kind: 'maintenance' | 'levy';
  amount_paid: number;
  payment_mode: string;
  payment_date: string;
  receipt_number: string | null;
  months_covered: number;
  months_detail: string | null;
  payment_status: string;
  is_voided: boolean;
};

export default function PaymentHistoryTable({ payments }: { payments: Payment[] }) {
  const [asc, setAsc] = useState(false);

  const sorted = [...payments].sort((a, b) => {
    const diff = a.payment_date.localeCompare(b.payment_date);
    return asc ? diff : -diff;
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b border-black/[0.06] text-left">
            <th className="pb-2.5 text-[13px] font-semibold text-sf-label2">
              <button
                onClick={() => setAsc(v => !v)}
                className="flex items-center gap-1 hover:text-sf-label transition-colors"
              >
                Date
                <ArrowUpDown size={13} className="text-sf-label3" />
              </button>
            </th>
            <th className="pb-2.5 text-[13px] font-semibold text-sf-label2 text-right">Amount</th>
            <th className="pb-2.5 text-[13px] font-semibold text-sf-label2">Type</th>
            <th className="pb-2.5 text-[13px] font-semibold text-sf-label2">Mode</th>
            <th className="pb-2.5 text-[13px] font-semibold text-sf-label2">Bill Period</th>
            <th className="pb-2.5 text-[13px] font-semibold text-sf-label2">Receipt</th>
            <th className="pb-2.5 text-[13px] font-semibold text-sf-label2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.04]">
          {sorted.map((p) => (
            <tr key={p.id} className="hover:bg-sf-bg">
              <td className="py-3 text-sf-label2">{formatDate(p.payment_date)}</td>
              <td className="py-3 text-right font-semibold text-sf-label">
                {formatINR(Number(p.amount_paid))}
              </td>
              <td className="py-3">
                <Badge color={p.kind === 'levy' ? 'blue' : 'gray'}>
                  {p.kind === 'levy' ? 'AMC' : 'Maintenance'}
                </Badge>
              </td>
              <td className="py-3">
                <Badge color={paymentModeBadge(p.payment_mode)}>
                  {p.payment_mode.replace(/_/g, ' ')}
                </Badge>
              </td>
              <td className="py-3 text-sf-label2">
                {p.months_detail ?? `${p.months_covered} mo`}
              </td>
              <td className="py-3 font-mono text-[13px] text-sf-label3">
                {p.receipt_number ?? '—'}
              </td>
              <td className="py-3">
                <Badge
                  color={
                    p.payment_status === 'PAID'    ? 'green'  :
                    p.payment_status === 'PARTIAL'  ? 'yellow' :
                    p.payment_status === 'ADVANCE'  ? 'blue'   :
                    'gray'
                  }
                >
                  {p.payment_status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
