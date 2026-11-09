import Link from 'next/link';
import type { PeriodKey, Quarter } from '@/lib/utils/period';
import { quarterOptions } from '@/lib/utils/period';
import FyDropdown from './FyDropdown';

export interface FyOption {
  value: string;
  label: string;
}

// The one period selector used by the payments hub, Reports, Expenses, and the
// Balance Sheet. Renders This Month · [Last Month] · FY ▾ · All Time · Custom
// on a single row — the FY dropdown replaced one chip per financial year,
// which wrapped into ragged rows and grew by one every April, forever.
// A Q1–Q4 segmented control sits inline next to the FY dropdown once a specific
// FY is in view — no more orphaned second row. Pass `fyOptions` to get the FY
// dropdown (reports/statements); omit it for a single "This FY" chip (activity
// lists). `keep` params survive every click so page-specific filters (type,
// flat, category…) are preserved. URL contract (period/fy/q) is unchanged.
export default function PeriodChips({
  basePath,
  keep = {},
  active,
  activeFy,
  activeQuarter,
  fyOptions,
  showLastMonth = false,
  showQuarters = false,
  from,
  to,
}: {
  basePath: string;
  keep?: Record<string, string | undefined>;
  active: PeriodKey;
  activeFy?: string;
  activeQuarter?: string;
  fyOptions?: FyOption[];
  showLastMonth?: boolean;
  showQuarters?: boolean;
  from?: string;
  to?: string;
}) {
  const href = (extra: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...extra })) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const cls = (isActive: boolean, small = false) =>
    [
      small ? 'h-7 px-2.5 text-[var(--text-xs)]' : 'h-8 px-3 text-[var(--text-sm)]',
      'flex items-center rounded-[var(--radius-md)] font-medium transition-all no-underline',
      isActive
        ? 'bg-[var(--sf-label)] text-white'
        : 'border border-[var(--sf-border)] text-[var(--sf-label3)] hover:text-[var(--sf-label2)] hover:bg-[rgba(144,174,173,0.08)]',
    ].join(' ');

  const quarterFy = (active === 'fy' || active === 'quarter') ? activeFy : undefined;

  const fyIsActive = active === 'fy' || active === 'quarter';
  const fyButtonLabel = fyOptions
    ? (fyIsActive && activeFy ? fyOptions.find(o => o.value === activeFy)?.label : undefined)
      ?? fyOptions.at(-1)?.label
      ?? 'FY'
    : undefined;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Link href={href({ period: 'month' })} className={cls(active === 'month')}>
        This Month
      </Link>
      {showLastMonth && (
        <Link href={href({ period: 'lastMonth' })} className={cls(active === 'lastMonth')}>
          Last Month
        </Link>
      )}
      {fyOptions ? (
        <FyDropdown
          label={fyButtonLabel!}
          isActive={fyIsActive}
          options={fyOptions.map(o => ({
            value: o.value,
            label: o.label,
            href: href({ period: 'fy', fy: o.value }),
            isActive: active === 'fy' && activeFy === o.value,
          }))}
        />
      ) : (
        <Link href={href({ period: 'fy' })} className={cls(active === 'fy')}>
          This FY
        </Link>
      )}

      {showQuarters && quarterFy && (
        <div className="flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--sf-border)] p-0.5">
          {quarterOptions().map(({ value, label }: { value: Quarter; label: string }) => (
            <Link
              key={value}
              href={href({ period: 'quarter', fy: quarterFy, q: String(value) })}
              className={[
                'flex h-6 items-center rounded-[var(--radius-sm)] px-2 text-[var(--text-xs)] font-medium transition-all no-underline',
                active === 'quarter' && activeQuarter === String(value)
                  ? 'bg-[var(--sf-label)] text-white'
                  : 'text-[var(--sf-label3)] hover:text-[var(--sf-label2)]',
              ].join(' ')}
            >
              {label}
            </Link>
          ))}
        </div>
      )}

      <Link href={href({ period: 'all' })} className={cls(active === 'all')}>
        All Time
      </Link>
      <Link href={href({ period: 'custom', from, to })} className={cls(active === 'custom')}>
        Custom
      </Link>
    </div>
  );
}
