import type { ReactNode } from 'react';

// One consistent page title row across the app: same size, weight, spacing, and
// optional inline count + right-aligned action slot. Replaces the per-page <h1> markup.
export default function PageHeader({
  title,
  subtitle,
  count,
  countLabel,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  count?: number | null;
  countLabel?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[var(--text-lg)] font-semibold text-[var(--sf-label)]">
          {title}
          {count != null && (
            <span className="ml-2 text-[var(--text-sm)] font-normal text-[var(--sf-label2)]">
              {count}{countLabel ? ` ${countLabel}` : ''}
            </span>
          )}
        </h1>
        {subtitle != null && (
          <p className="mt-0.5 break-words text-[var(--text-sm)] text-[var(--sf-label2)]">
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
