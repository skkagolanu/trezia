'use client';
import { formatINR } from '@/lib/utils/currency';
import type { DuesRow } from '@/lib/utils/agent-guards';

// Renders the checkDues tool's structured `rows` as a compact table instead of
// leaving the treasurer to read prose. Read-only — mirrors data already shown
// on /reports; no write affordance, consistent with the agent's read-only scope.
export function DuesResultCard({ rows }: { rows: DuesRow[] }) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.totalDue - a.totalDue);
  const total = sorted.reduce((s, r) => s + r.totalDue, 0);

  return (
    <div className="mt-1.5 overflow-hidden rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg)]">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-[var(--sf-divider)] text-left">
            <th className="px-2.5 py-1.5 font-semibold text-[var(--sf-label2)]">Flat</th>
            {sorted.some(r => r.resident) && <th className="px-2.5 py-1.5 font-semibold text-[var(--sf-label2)]">Resident</th>}
            <th className="px-2.5 py-1.5 text-right font-semibold text-[var(--sf-label2)]">Months</th>
            <th className="px-2.5 py-1.5 text-right font-semibold text-[var(--sf-label2)]">Due</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--sf-divider)]">
          {sorted.map(r => (
            <tr key={r.flat}>
              <td className="px-2.5 py-1.5 font-medium text-[var(--sf-label)]">{r.flat}</td>
              {sorted.some(x => x.resident) && <td className="px-2.5 py-1.5 text-[var(--sf-label2)]">{r.resident ?? '—'}</td>}
              <td className="px-2.5 py-1.5 text-right tabular text-[var(--sf-label2)]">{r.monthsOverdue}</td>
              <td className="px-2.5 py-1.5 text-right tabular font-semibold text-sf-red">{formatINR(r.totalDue)}</td>
            </tr>
          ))}
        </tbody>
        {sorted.length > 1 && (
          <tfoot>
            <tr className="border-t border-[var(--sf-divider)]">
              <td colSpan={sorted.some(r => r.resident) ? 2 : 1} className="px-2.5 py-1.5 font-semibold text-[var(--sf-label)]">Total</td>
              <td className="px-2.5 py-1.5 text-right tabular text-[var(--sf-label3)]">{sorted.length} flats</td>
              <td className="px-2.5 py-1.5 text-right tabular font-bold text-sf-red">{formatINR(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
