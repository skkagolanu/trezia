'use client';

import { useState, useMemo } from 'react';
import Badge from '@/components/ui/Badge';
import VoidButton from '@/components/ui/VoidButton';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import type { ExpenseCategory, Expenditure } from '@/types/database';
import { CATEGORY_LABELS } from '@/lib/constants/categories';

type SortCol = 'date' | 'amount' | 'category';
interface SortState { col: SortCol; dir: 'asc' | 'desc' }

function SortTh({ label, col, sort, onSort, right = false }: {
  label: string; col: SortCol; sort: SortState; onSort: (c: SortCol) => void; right?: boolean;
}) {
  const active = sort.col === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`pb-3 text-[var(--text-xs)] font-semibold text-sf-label2 whitespace-nowrap cursor-pointer select-none hover:text-[var(--sf-label)] transition-colors ${right ? 'text-right' : 'text-left'}`}
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

interface Props {
  expenses: Expenditure[];
}

export default function ExpensesTableBody({ expenses }: Props) {
  const [optimisticVoids, setOptimisticVoids] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ col: 'date', dir: 'desc' });

  function onSort(col: SortCol) {
    setSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'amount' ? 'desc' : 'asc' });
  }

  const sorted = useMemo(() => {
    return [...expenses].sort((a, b) => {
      let cmp = 0;
      if (sort.col === 'date') {
        cmp = a.expense_date.localeCompare(b.expense_date);
      } else if (sort.col === 'amount') {
        cmp = Number(a.amount) - Number(b.amount);
      } else {
        cmp = (CATEGORY_LABELS[a.category as ExpenseCategory] ?? a.category).localeCompare(
              CATEGORY_LABELS[b.category as ExpenseCategory] ?? b.category);
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [expenses, sort]);

  return (
    <>
      <thead>
        <tr className="border-b border-black/[0.06] text-left">
          <SortTh label="Date"     col="date"     sort={sort} onSort={onSort} />
          <SortTh label="Category" col="category" sort={sort} onSort={onSort} />
          <th className="pb-3 text-[var(--text-xs)] font-semibold text-sf-label2">Description</th>
          <SortTh label="Amount"   col="amount"   sort={sort} onSort={onSort} right />
          <th className="pb-3 text-[var(--text-xs)] font-semibold text-sf-label2">Paid Via</th>
          <th className="pb-3 text-[var(--text-xs)] font-semibold text-sf-label2">Payee</th>
          <th className="pb-3 text-[var(--text-xs)] font-semibold text-sf-label2">FY Treasurer</th>
          <th className="pb-3 text-[var(--text-xs)] font-semibold text-sf-label2">Status</th>
          <th className="pb-3" />
        </tr>
      </thead>
      <tbody className="divide-y divide-black/[0.04]">
        {sorted.map(exp => {
          const isVoided = exp.is_voided || optimisticVoids.has(exp.id);
          return (
            <tr key={exp.id} className={`group hover:bg-sf-bg transition-colors ${isVoided ? 'opacity-50' : ''}`}>
              <td className="py-3.5 text-sf-label2 whitespace-nowrap">{formatDate(exp.expense_date)}</td>
              <td className="py-3.5">
                <Badge color="blue">
                  {CATEGORY_LABELS[exp.category as ExpenseCategory] ?? exp.category}
                </Badge>
              </td>
              <td className="py-3.5 text-sf-label max-w-xs truncate">{exp.description}</td>
              <td className="py-3.5 text-right font-semibold text-sf-label whitespace-nowrap tabular">
                {formatINR(Number(exp.amount))}
              </td>
              <td className="py-3.5 text-sf-label2">{exp.paid_via ?? '—'}</td>
              <td className="py-3.5 text-sf-label2">{exp.payee_name ?? '—'}</td>
              <td className="py-3.5 text-sf-label2 whitespace-nowrap">{exp.recorded_by ?? '—'}</td>
              <td className="py-3.5">
                {isVoided
                  ? <Badge color="red">Voided</Badge>
                  : <Badge color="green">Active</Badge>}
              </td>
              <td className="py-3.5">
                <div className="opacity-0 group-hover:opacity-100 sm:transition-opacity sm:duration-100 max-sm:opacity-100">
                  {!isVoided && (
                    <VoidButton
                      id={exp.id}
                      endpoint="/api/expenses"
                      onOptimisticVoid={() => setOptimisticVoids(prev => new Set([...prev, exp.id]))}
                      onVoidFail={() => setOptimisticVoids(prev => { const s = new Set(prev); s.delete(exp.id); return s; })}
                    />
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </>
  );
}
