'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import { formatINR } from '@/lib/utils/currency';
import UnitActions from '../units/UnitActions';
import UnitMonthlyAmountButton from './UnitMonthlyAmountButton';
import type { Unit } from '@/types/database';
import type { Resident } from '@/types/database';
import { useSocietyPath } from '@/lib/hooks/use-society-path';

type DuesSummaryLike = { total_due: number; unpaid_months: number; unpaid_levies: number };

type ResidentRow = Resident;

type UnitWithResidents = Unit & { residents: ResidentRow[] };

type SortCol = 'flat' | 'dues';
interface SortState { col: SortCol; dir: 'asc' | 'desc' }

function SortTh({ label, col, sort, onSort, right = false }: {
  label: string; col: SortCol; sort: SortState; onSort: (c: SortCol) => void; right?: boolean;
}) {
  const active = sort.col === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`pb-2 text-[var(--text-xs)] font-semibold cursor-pointer select-none hover:text-[var(--sf-label)] transition-colors ${right ? 'text-right' : 'text-left'}`}
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

function occupancyColor(type: string): 'blue' | 'green' | 'gray' {
  if (type === 'OWNER') return 'blue';
  if (type === 'TENANT') return 'green';
  return 'gray';
}

interface Props {
  units: UnitWithResidents[];
  duesRecord: Record<string, DuesSummaryLike>;
  defaultAmount: number;
  canManageUnits: boolean;
}

export default function ResidentsTableBody({ units, duesRecord, defaultAmount, canManageUnits }: Props) {
  const scoped = useSocietyPath();
  const [sort, setSort] = useState<SortState>({ col: 'flat', dir: 'asc' });

  function onSort(col: SortCol) {
    setSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'dues' ? 'desc' : 'asc' });
  }

  const sorted = useMemo(() => {
    return [...units].sort((a, b) => {
      let cmp = 0;
      if (sort.col === 'flat') {
        cmp = a.flat_number.localeCompare(b.flat_number);
      } else {
        const da = duesRecord[a.flat_number]?.total_due ?? 0;
        const db = duesRecord[b.flat_number]?.total_due ?? 0;
        cmp = Number(da) - Number(db);
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [units, sort, duesRecord]);

  return (
    <>
      <thead>
        <tr className="border-b border-black/[0.06] text-left text-[var(--text-xs)] text-sf-label2">
          <SortTh label="Flat"    col="flat" sort={sort} onSort={onSort} />
          <th className="pb-2 font-semibold">Resident</th>
          <th className="pb-2 font-semibold">Type</th>
          <th className="pb-2 font-semibold">Phone</th>
          <SortTh label="Dues"   col="dues" sort={sort} onSort={onSort} />
          <th className="pb-2 font-semibold text-right">Monthly</th>
          <th className="pb-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-black/[0.04]">
        {sorted.map(unit => {
          const residents = Array.isArray(unit.residents) ? unit.residents : [];
          const primary   = residents.find(r => r.is_primary && r.is_active) ?? residents.find(r => r.is_active) ?? null;
          const due       = duesRecord[unit.flat_number];
          const totalDue  = due?.total_due ?? 0;

          return (
            <tr key={unit.id} className="group hover:bg-sf-bg transition-colors">
              <td className="py-3 font-semibold text-sf-label">
                <Link href={scoped(`/residents/${unit.id}`)} className="hover:text-sf-blue hover:underline">
                  {unit.flat_number}
                </Link>
                {unit.is_test_unit && (
                  <Badge color="gray" className="ml-2">TEST</Badge>
                )}
              </td>
              <td className="py-3 text-sf-label">
                {primary?.full_name ?? <span className="text-sf-label3">—</span>}
              </td>
              <td className="py-3">
                {primary ? (
                  <Badge color={occupancyColor(primary.occupancy_type)}>
                    {primary.occupancy_type}
                  </Badge>
                ) : (
                  <Badge color="gray">VACANT</Badge>
                )}
              </td>
              <td className="py-3 text-sf-label2 whitespace-nowrap">
                {primary?.phone ? (
                  <a href={`tel:${primary.phone}`} className="hover:text-sf-blue hover:underline">
                    {primary.phone}
                  </a>
                ) : (
                  <span className="text-sf-label3">—</span>
                )}
              </td>
              <td className="py-3">
                {due ? (
                  <Badge color={totalDue > 0 ? 'red' : 'green'}>
                    {totalDue > 0
                      ? `${formatINR(totalDue)} · ${[
                          due.unpaid_months > 0 ? `${due.unpaid_months}mo` : '',
                          due.unpaid_levies > 0 ? `${due.unpaid_levies} AMC` : '',
                        ].filter(Boolean).join(' + ')}`
                      : 'Paid'}
                  </Badge>
                ) : (
                  <Badge color="gray">No data</Badge>
                )}
              </td>
              <td className="py-3 text-right text-sf-label2 whitespace-nowrap">
                {unit.monthly_amount != null
                  ? formatINR(Number(unit.monthly_amount))
                  : <span className="text-sf-label3 text-[var(--text-xs)]">{formatINR(defaultAmount)}</span>
                }
              </td>
              <td className="py-3 text-right">
                <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 sm:transition-opacity sm:duration-100 max-sm:opacity-100">
                  {canManageUnits
                    ? <UnitActions mode="edit" unit={unit} defaultAmount={defaultAmount} />
                    : <UnitMonthlyAmountButton unitId={unit.id} flatNumber={unit.flat_number} amount={unit.monthly_amount == null ? null : Number(unit.monthly_amount)} />}
                  <Link
                    href={scoped(`/residents/${unit.id}`)}
                    className="rounded px-2 py-1 text-[var(--text-xs)] font-medium text-sf-blue hover:bg-sf-blue/[0.08] transition-colors"
                  >
                    View
                  </Link>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </>
  );
}
