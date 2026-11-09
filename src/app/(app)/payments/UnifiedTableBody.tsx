'use client';

import { useState, useMemo } from 'react';
import Badge, { paymentModeBadge } from '@/components/ui/Badge';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import RowActions from './RowActions';

export type UnifiedRow = {
  id: string;
  kind: 'payment' | 'levy';
  flat: string;
  resident: string;
  phone: string | null;
  email: string | null;
  amount: number;
  mode: string;
  date: string;
  period: string;
  recordedBy: string | null;
  isVoided: boolean;
  receiptNumber: string | null;
  pdfUrl: string | null;
};

type SortCol = 'flat' | 'amount' | 'date';
interface SortState { col: SortCol; dir: 'asc' | 'desc' }

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

export default function UnifiedTableBody({ rows }: { rows: UnifiedRow[] }) {
  const [optimisticVoids, setOptimisticVoids] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ col: 'date', dir: 'desc' });

  function onSort(col: SortCol) {
    setSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'amount' ? 'desc' : 'asc' });
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sort.col === 'flat') {
        cmp = a.flat.localeCompare(b.flat);
      } else if (sort.col === 'amount') {
        cmp = a.amount - b.amount;
      } else {
        cmp = a.date.localeCompare(b.date);
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort]);

  return (
    <>
      <thead>
        <tr className="border-b border-[var(--sf-divider)]">
          <SortTh label="Flat"   col="flat"   sort={sort} onSort={onSort} />
          <th className="h-8 px-3 text-left text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] whitespace-nowrap w-full">Resident</th>
          <SortTh label="Amount" col="amount" sort={sort} onSort={onSort} right />
          <PlainTh label="Type" />
          <SortTh label="Date"   col="date"   sort={sort} onSort={onSort} />
          <PlainTh label="Mode" />
          <PlainTh label="FY Treasurer" />
          <th className="h-8 px-3 whitespace-nowrap" />
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--sf-divider)]">
        {sorted.length > 0 ? sorted.map((row, i) => {
          const isVoided = row.isVoided || optimisticVoids.has(row.id);
          return (
            <tr
              key={`${row.kind}-${row.id}`}
              className={`group text-[var(--text-base)] transition-colors ${isVoided ? 'opacity-50' : 'hover:bg-black/[0.02]'} ${i % 2 === 1 ? 'bg-black/[0.01]' : ''}`}
            >
              <td className="px-3 py-2.5 font-semibold text-[var(--sf-label)]">{row.flat}</td>
              <td className="px-3 py-2.5 text-[var(--sf-label2)] w-full">{row.resident}</td>
              <td className="px-3 py-2.5 text-right tabular font-semibold text-[var(--sf-label)]">{formatINR(row.amount)}</td>
              <td className="px-3 py-2.5">
                <span className={`inline-flex items-center h-5 px-1.5 rounded text-[var(--text-xs)] font-medium whitespace-nowrap ${
                  row.kind === 'levy'
                    ? 'bg-[color-mix(in_srgb,var(--sf-label)_10%,transparent)] text-[var(--sf-label)]'
                    : 'bg-[color-mix(in_srgb,var(--sf-label3)_15%,transparent)] text-[var(--sf-label2)]'
                }`}>
                  {row.kind === 'levy' ? row.period : 'Maintenance'}
                </span>
              </td>
              <td className="px-3 py-2.5 font-mono text-[var(--text-xs)] text-[var(--sf-label2)] whitespace-nowrap">{formatDate(row.date)}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <Badge color={paymentModeBadge(row.mode)}>{row.mode.replace(/_/g, ' ')}</Badge>
              </td>
              <td className="px-3 py-2.5 text-[var(--sf-label2)] whitespace-nowrap">{row.recordedBy ?? '—'}</td>
              <td className="px-3 py-2.5">
                <div className="opacity-0 group-hover:opacity-100 sm:transition-opacity sm:duration-100 max-sm:opacity-100">
                  <RowActions
                    kind={row.kind}
                    id={row.id}
                    receiptNumber={row.receiptNumber}
                    email={row.email}
                    phone={row.phone}
                    residentName={row.resident}
                    period={row.period}
                    amount={row.amount}
                    isVoided={isVoided}
                    onOptimisticVoid={() => setOptimisticVoids(prev => new Set([...prev, row.id]))}
                    onVoidFail={() => setOptimisticVoids(prev => { const s = new Set(prev); s.delete(row.id); return s; })}
                  />
                </div>
              </td>
            </tr>
          );
        }) : (
          <tr>
            <td colSpan={8} className="py-12 text-center text-[var(--text-sm)] text-[var(--sf-label3)]">
              No payments found.
            </td>
          </tr>
        )}
      </tbody>
    </>
  );
}
