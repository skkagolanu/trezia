/* Shown immediately on any navigation within the app shell.
   The layout (TopNav + header) stays visible; only this content
   area swaps in the moment the link is clicked, before the server
   response arrives. */

const SHIMMER = 'bg-[color-mix(in_srgb,var(--sf-label2)_15%,transparent)] rounded-lg animate-pulse motion-reduce:animate-none';

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 border-b border-[var(--sf-divider)] last:border-0">
      <div className={`h-3.5 w-14 shrink-0 ${SHIMMER}`} />
      <div className={`h-3.5 w-32 ${SHIMMER}`} />
      <div className={`h-3.5 w-20 ${SHIMMER}`} />
      <div className={`h-3.5 w-24 ${SHIMMER}`} />
      <div className={`h-3.5 w-16 ml-auto ${SHIMMER}`} />
      <div className={`h-6 w-14 ${SHIMMER}`} />
    </div>
  );
}

export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading page content">
      <div aria-hidden="true" className="flex flex-col gap-5">
        {/* Page heading */}
        <div className={`h-6 w-40 ${SHIMMER}`} />

        {/* Tab bar / filter strip */}
        <div className="flex items-center gap-2">
          <div className={`h-8 w-28 ${SHIMMER}`} />
          <div className={`h-8 w-28 ${SHIMMER}`} />
          <div className={`h-8 w-20 ml-auto ${SHIMMER}`} />
          <div className={`h-8 w-20 ${SHIMMER}`} />
        </div>

        {/* Table card */}
        <div className="rounded-xl bg-[var(--sf-surface)] border border-[var(--sf-border)] overflow-hidden">
          {/* Column headers */}
          <div className="flex items-center gap-4 px-4 py-3 border-b border-[var(--sf-divider)]">
            {[56, 96, 72, 80, 64, 56].map((w, i) => (
              <div
                key={i}
                className={`h-3 shrink-0 ${SHIMMER}`}
                style={{ width: w, opacity: 0.7 }}
              />
            ))}
          </div>

          {/* Data rows */}
          {Array.from({ length: 10 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
