import Link from 'next/link';

export const metadata = { title: 'Page not found · Trezia' };

// Root not-found — catches both bare 404s and scoped-rewritten ones
// (/s/{slug}/whatever). The "plain anchors only" rationale belongs to
// global-error.tsx (which replaces the whole document); this renders
// inside the intact root layout, so Link is safe and lint-required here.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--sf-bg)] px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sf-label3)_16%,transparent)]">
          <svg className="h-6 w-6 text-[var(--sf-label3)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.5m0 3.75h.007v.008H12v-.008ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>
        <h1 className="text-[var(--text-lg)] font-semibold text-[var(--sf-label)]">Page not found</h1>
        <p className="text-[var(--text-sm)] text-[var(--sf-label2)]">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center h-9 px-4 rounded-[var(--radius-md)] bg-[var(--sf-blue)] text-[var(--text-sm)] font-semibold text-white hover:opacity-90 transition-opacity no-underline"
          >
            Go to home
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-9 px-4 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-sm)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04] transition-colors no-underline"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
