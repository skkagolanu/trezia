'use client';
import KpiCountUp from '@/components/ui/KpiCountUp';
import Tooltip from '@/components/ui/Tooltip';
import { formatINR } from '@/lib/utils/currency';

interface Props {
  label: string;
  rawValue: number;
  prefix?: string;
  sub: string;
  color: 'green' | 'red';
  tip?: string;
}

export default function KPICard({ label, rawValue, prefix, sub, color, tip }: Props) {
  const valueColor = color === 'green' ? 'text-sf-green' : 'text-sf-red';
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2.5">
      <div className="flex items-center gap-1">
        <p className="text-[var(--text-xs)] text-[var(--sf-label2)]">{label}</p>
        {tip && <Tooltip text={tip} />}
      </div>
      <p className={`text-[var(--text-md)] font-bold tabular mt-0.5 leading-none ${valueColor}`}>
        {prefix}<KpiCountUp value={rawValue} format={formatINR} />
      </p>
      <p className="text-[var(--text-xs)] text-[var(--sf-label3)] mt-1">{sub}</p>
    </div>
  );
}
