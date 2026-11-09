import Link from 'next/link';
import { societyPath } from '@/lib/society-path';

// Shared across every /payments route. Only "All" and "Maintenance" live at
// /payments itself (as ?type=maintenance) — AMC/CMC, Other Income, Bills, and
// Attention each moved to their own path so a bookmark or the back button
// lands on a real, distinct URL instead of a query-string mode switch.
const TABS = [
  ['all', 'All', '/payments'],
  ['maintenance', 'Maintenance', '/payments?type=maintenance'],
  ['amc', 'AMC', '/payments/levies'],
  ['other-income', 'Other Income', '/payments/other-income'],
  ['bills', 'Bills', '/payments/bills'],
  ['attention', 'Attention', '/payments/attention'],
] as const;

export default function TypeChips({ active, societySlug }: { active: string; societySlug: string | null }) {
  return (
    <div className="flex flex-wrap gap-1">
      {TABS.map(([t, label, href]) => (
        <Link
          key={t}
          href={societyPath(societySlug, href)}
          className={[
            'h-8 px-3 flex items-center rounded-[var(--radius-md)] text-[var(--text-sm)] font-medium transition-all no-underline',
            active === t
              ? 'bg-[var(--sf-label)] text-white'
              : 'border border-[var(--sf-border)] text-[var(--sf-label2)] hover:bg-[rgba(144,174,173,0.12)]',
          ].join(' ')}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
