// rule 3). Each skeleton mirrors the real component's box model so nothing
// reflows (CLS) when the real content swaps in.

export function ChartSkeleton({ height = 120 }: { height?: number }) {
  return (
    <div
      className="w-full animate-pulse rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sf-label3)_10%,transparent)]"
      style={{ height }}
    />
  );
}

export function KPICardSkeleton() {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2.5 animate-pulse">
      <div className="h-3 w-16 rounded bg-[color-mix(in_srgb,var(--sf-label3)_16%,transparent)]" />
      <div className="mt-2 h-5 w-24 rounded bg-[color-mix(in_srgb,var(--sf-label3)_20%,transparent)]" />
      <div className="mt-2 h-2.5 w-20 rounded bg-[color-mix(in_srgb,var(--sf-label3)_12%,transparent)]" />
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-[var(--sf-divider)]">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5 animate-pulse">
          <div className="h-3 w-16 rounded bg-[color-mix(in_srgb,var(--sf-label3)_14%,transparent)]" />
          <div className="h-3 flex-1 rounded bg-[color-mix(in_srgb,var(--sf-label3)_10%,transparent)]" />
          <div className="h-3 w-20 rounded bg-[color-mix(in_srgb,var(--sf-label3)_14%,transparent)]" />
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sf-label3)_10%,transparent)]" />
        ))}
      </div>
      <div className="h-8 w-64 animate-pulse rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sf-label3)_8%,transparent)]" />
      <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] overflow-hidden">
        <TableSkeleton rows={rows} />
      </div>
    </div>
  );
}

export function ReportsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-8 w-20 animate-pulse rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sf-label3)_10%,transparent)]" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <KPICardSkeleton key={i} />)}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3">
          <ChartSkeleton />
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3">
          <ChartSkeleton />
        </div>
      </div>
    </div>
  );
}
