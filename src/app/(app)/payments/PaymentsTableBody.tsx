'use client';

import { useState, useMemo } from 'react';
import Badge, { paymentModeBadge } from '@/components/ui/Badge';
import VoidButton from '@/components/ui/VoidButton';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import ReceiptActions from './ReceiptActions';

type PaymentRow = {
  id: string;
  receipt_number: string | null;
  receipt_pdf_url: string | null;
  amount_paid: number;
  payment_mode: string;
  payment_date: string | null;
  months_detail: string | null;
  recorded_by: string | null;
  is_voided: boolean;
  unit: { flat_number: string } | null;
  resident: { full_name: string; phone: string | null } | null;
};

type SortCol = 'flat' | 'amount' | 'date';
interface SortState { col: SortCol; dir: 'asc' | 'desc' }

interface Props {
  payments: PaymentRow[];
}

function SortTh({ label, col, sort, onSort, right = false }: {
  label: string; col: SortCol; sort: SortState; onSort: (c: SortCol) => void; right?: boolean;
}) {
  const active = sort.col === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`h-8 px-3 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] whitespace-nowrap cursor-pointer select-none hover:text-[var(--sf-label)] transition-colors ${right ? 'text-right' : 'text-left'}`}
    >
      <span className={`inline-flex items-center gap-0.5 ${right ? 'justify-end w-full' : ''}`}>
        {label}
        <span className={`text-[9px] transition-opacity ${active ? 'opacity-100' : 'opacity-20'}`}>
          {active && sort.dir === 'asc' ? '↑' : '↓'}
        </span>
      </span>
    </th>
  );
}

function PlainTh({ label, right = false }: { label: string; right?: boolean }) {
  return (
    <th className={`h-8 px-3 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
      {label}
    </th>
  );
}

export default function PaymentsTableBody({ payments }: Props) {
  const [optimisticVoids, setOptimisticVoids] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ col: 'date', dir: 'desc' });

  function onSort(col: SortCol) {
    setSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'amount' ? 'desc' : 'asc' });
  }

  const sorted = useMemo(() => {
    return [...payments].sort((a, b) => {
      let cmp = 0;
      if (sort.col === 'flat') {
        cmp = (a.unit?.flat_number ?? '').localeCompare(b.unit?.flat_number ?? '');
      } else if (sort.col === 'amount') {
        cmp = a.amount_paid - b.amount_paid;
      } else {
        cmp = (a.payment_date ?? '').localeCompare(b.payment_date ?? '');
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [payments, sort]);

  return (
    <>
      <thead>
        <tr className="border-b border-[var(--sf-divider)]">
          <PlainTh label="Receipt" />
          <SortTh label="Flat"   col="flat"   sort={sort} onSort={onSort} />
          <PlainTh label="Resident" />
          <SortTh label="Amount" col="amount" sort={sort} onSort={onSort} right />
          <PlainTh label="Period" />
          <PlainTh label="Mode" />
          <SortTh label="Date"   col="date"   sort={sort} onSort={onSort} />
          <PlainTh label="FY Treasurer" />
          <th className="h-8 px-3" />
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--sf-divider)]">
        {sorted.length > 0 ? sorted.map((p, i) => {
          const isVoided = p.is_voided || optimisticVoids.has(p.id);
          return (
            <tr
              key={p.id}
              className={[
                'group h-9 transition-colors',
                isVoided ? 'opacity-50' : 'hover:bg-black/[0.02]',
                i % 2 === 1 ? 'bg-black/[0.015]' : '',
              ].join(' ')}
            >
              <td className="px-3 font-mono text-[var(--text-xs)] text-[var(--sf-label3)]">{p.receipt_number ?? '—'}</td>
              <td className="px-3 text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">{p.unit?.flat_number ?? '—'}</td>
              <td className="px-3 text-[var(--text-sm)] text-[var(--sf-label2)]">{p.resident?.full_name ?? '—'}</td>
              <td className="px-3 text-right tabular text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">{formatINR(Number(p.amount_paid))}</td>
              <td className="px-3 font-mono text-[var(--text-xs)] text-[var(--sf-label3)]">{p.months_detail ?? '—'}</td>
              <td className="px-3">
                <Badge color={paymentModeBadge(p.payment_mode)}>{p.payment_mode.replace(/_/g, ' ')}</Badge>
              </td>
              <td className="px-3 font-mono text-[var(--text-xs)] text-[var(--sf-label2)]">{formatDate(p.payment_date ?? '')}</td>
              <td className="px-3 text-[var(--text-sm)] text-[var(--sf-label2)] whitespace-nowrap">{p.recorded_by ?? '—'}</td>
              <td className="px-3">
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 sm:transition-opacity sm:duration-100 max-sm:opacity-100">
                  {!isVoided && p.receipt_number && (
                    <ReceiptActions
                      paymentId={p.id}
                      receiptNumber={p.receipt_number}
                      hasStoredPdf={Boolean(p.receipt_pdf_url)}
                      phone={p.resident?.phone ?? null}
                      residentName={p.resident?.full_name ?? 'Resident'}
                      monthsPeriod={p.months_detail ?? formatDate(p.payment_date ?? '')}
                      amountPaid={Number(p.amount_paid)}
                    />
                  )}
                  {!isVoided && (
                    <VoidButton
                      id={p.id}
                      endpoint="/api/payments"
                      onOptimisticVoid={() => setOptimisticVoids(prev => new Set([...prev, p.id]))}
                      onVoidFail={() => setOptimisticVoids(prev => { const s = new Set(prev); s.delete(p.id); return s; })}
                    />
                  )}
                  {isVoided && <span className="text-[var(--text-xs)] text-[var(--sf-label3)]">Voided</span>}
                </div>
              </td>
            </tr>
          );
        }) : (
          <tr>
            <td colSpan={9} className="py-10 text-center text-[var(--text-sm)] text-[var(--sf-label3)]">No payments found.</td>
          </tr>
        )}
      </tbody>
    </>
  );
}
