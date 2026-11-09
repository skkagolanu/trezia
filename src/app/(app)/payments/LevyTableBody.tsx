'use client';

import { useState, useMemo } from 'react';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import LevyRowActions from './LevyRowActions';
import RecordLevyPaymentButton from './RecordLevyPaymentButton';
import Tooltip from '@/components/ui/Tooltip';
import type { AmcCollection } from '@/types/database';
import { aggregateLevyCollections, levyStatusFor, outstandingLevy, type LevyAssessmentLike } from '@/lib/utils/levies';

type UnitRow = {
  id: string;
  flat_number: string;
  primaryResident: string | null;
  primaryResidentId: string | null;
};

interface Props {
  units: UnitRow[];
  paidCollections: AmcCollection[];
  activeLabel: string;
  defaultAmount: number;
  assessmentsByUnit: Record<string, LevyAssessmentLike>;
}

type SortCol = 'flat' | 'amount' | 'date' | 'status';
interface SortState { col: SortCol; dir: 'asc' | 'desc' }

function SortTh({ label, col, sort, onSort, right = false, tip }: {
  label: string; col: SortCol; sort: SortState; onSort: (c: SortCol) => void; right?: boolean; tip?: React.ReactNode;
}) {
  const active = sort.col === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`h-8 px-3 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] whitespace-nowrap cursor-pointer select-none hover:text-[var(--sf-label)] transition-colors ${right ? 'text-right' : 'text-left'}`}
    >
      <span className={`inline-flex items-center gap-0.5 ${right ? 'justify-end w-full' : ''}`}>
        {label}
        {tip}
        <span className={`text-[9px] transition-opacity ${active ? 'opacity-100' : 'opacity-20'}`}>
          {active && sort.dir === 'asc' ? '↑' : '↓'}
        </span>
      </span>
    </th>
  );
}

function PlainTh({ label }: { label: string }) {
  return (
    <th className="h-8 px-3 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] whitespace-nowrap text-left">
      {label}
    </th>
  );
}

export default function LevyTableBody({ units, paidCollections, activeLabel, defaultAmount, assessmentsByUnit }: Props) {
  const [optimisticVoidedCollections, setOptimisticVoidedCollections] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ col: 'flat', dir: 'asc' });

  function onSort(col: SortCol) {
    setSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'amount' ? 'desc' : 'asc' });
  }

  const assessmentMap = useMemo(() => new Map(Object.entries(assessmentsByUnit)), [assessmentsByUnit]);
  const summaries = useMemo(
    () => aggregateLevyCollections(
      paidCollections.filter(collection => !optimisticVoidedCollections.has(collection.id)),
      defaultAmount,
      assessmentMap,
    ),
    [paidCollections, defaultAmount, assessmentMap, optimisticVoidedCollections],
  );

  const sortedUnits = useMemo(() => {
    return [...units].sort((a, b) => {
      const ca = summaries.get(a.id);
      const cb = summaries.get(b.id);
      const statusA = ca?.status ?? 'pending';
      const statusB = cb?.status ?? 'pending';

      let cmp = 0;
      if (sort.col === 'flat') {
        cmp = a.flat_number.localeCompare(b.flat_number);
      } else if (sort.col === 'amount') {
        cmp = (ca?.total ?? 0) - (cb?.total ?? 0);
      } else if (sort.col === 'date') {
        cmp = (ca?.latest?.payment_date ?? '').localeCompare(cb?.latest?.payment_date ?? '');
      } else {
        const rank = { paid: 0, partial: 1, pending: 2 } as const;
        cmp = rank[statusA] - rank[statusB];
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [units, sort, summaries]);

  return (
    <>
      <thead>
        <tr className="border-b border-[var(--sf-divider)]">
          <SortTh label="Flat"   col="flat"   sort={sort} onSort={onSort} />
          <PlainTh label="Resident" />
          <SortTh label="Amount" col="amount" sort={sort} onSort={onSort} right />
          <PlainTh label="Mode" />
          <SortTh label="Date"   col="date"   sort={sort} onSort={onSort} />
          <PlainTh label="FY Treasurer" />
          <SortTh
            label="Status" col="status" sort={sort} onSort={onSort}
            tip={<Tooltip text="✓ Paid: expected amount collected. ◐ Partial: some amount collected. ○ Pending: nothing collected." />}
          />
          <th className="h-8 px-3" />
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--sf-divider)]">
        {sortedUnits.map((unit, i) => {
          const summary = summaries.get(unit.id);
          const c = summary?.latest ?? null;
          const total = summary?.total ?? 0;
          const assessment = assessmentMap.get(unit.id);
          const expected = Number(assessment?.amount ?? defaultAmount);
          const status = levyStatusFor(total, expected, assessment);
          const remaining = assessment ? outstandingLevy(assessment) : Math.max(expected - total, 0);

          return (
            <tr
              key={unit.id}
              className={`group h-9 hover:bg-black/[0.02] transition-colors ${i % 2 === 1 ? 'bg-black/[0.015]' : ''}`}
            >
              <td className="px-3 text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">{unit.flat_number}</td>
              <td className="px-3 text-[var(--text-sm)] text-[var(--sf-label2)]">{unit.primaryResident ?? '—'}</td>
              <td className="px-3 text-right tabular text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">
                {total > 0 ? formatINR(total) : '—'}
              </td>
              <td className="px-3 text-[var(--text-sm)] text-[var(--sf-label2)]">
                {c ? c.payment_mode.replace(/_/g, ' ') : '—'}
              </td>
              <td className="px-3 font-mono text-[var(--text-xs)] text-[var(--sf-label2)]">
                {c?.payment_date ? formatDate(c.payment_date) : '—'}
              </td>
              <td className="px-3 text-[var(--text-sm)] text-[var(--sf-label2)] whitespace-nowrap">
                {c?.recorded_by ?? '—'}
              </td>
              <td className="px-3">
                {status === 'paid' ? (
                  <span className="text-[var(--text-sm)] font-medium text-sf-green">✓ Paid</span>
                ) : status === 'partial' ? (
                  <span className="text-[var(--text-sm)] font-medium text-[var(--sf-orange)]">◐ Partial</span>
                ) : (
                  <span className="text-[var(--text-sm)] text-[var(--sf-label3)]">○ Pending</span>
                )}
              </td>
              <td className="px-3">
                <div className="opacity-0 group-hover:opacity-100 sm:transition-opacity sm:duration-100 max-sm:opacity-100">
                  <div className="flex items-center gap-1">
                    {c && (
                      <LevyRowActions
                        id={c.id}
                        amountPaid={Number(c.amount_paid)}
                        paymentDate={c.payment_date ?? null}
                        notes={c.notes ?? null}
                        paymentMode={c.payment_mode ?? 'MANUAL_COLLECTION'}
                        onOptimisticVoid={() => setOptimisticVoidedCollections(prev => new Set([...prev, c.id]))}
                        onVoidFail={() => setOptimisticVoidedCollections(prev => { const s = new Set(prev); s.delete(c.id); return s; })}
                      />
                    )}
                    {status !== 'paid' && (
                      <RecordLevyPaymentButton
                        unitId={unit.id}
                        flatNumber={unit.flat_number}
                        levyLabel={activeLabel}
                        defaultAmount={remaining || expected}
                        residentId={unit.primaryResidentId}
                      />
                    )}
                  </div>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </>
  );
}
