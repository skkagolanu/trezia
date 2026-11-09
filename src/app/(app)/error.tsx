'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import * as Sentry from '@sentry/nextjs';
import { useSocietyPath } from '@/lib/hooks/use-society-path';

// Catches any thrown error from a Server Component inside the (app) shell —
// TopNav and layout stay mounted; only this segment's content is replaced.
// Without this file, ANY unhandled query error anywhere on ANY admin page
// took down the whole page with Next's generic "Application error… Digest:
// <number>" screen and no way back except a manual URL edit (2026-07-09
// incident — /payments and /balance-sheet both threw a bare error with no
// boundary to catch it). This is the standing safety net going forward; it
// does not fix the underlying query failure, it just stops one bad query
// from stranding the treasurer on a dead page.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const scoped = useSocietyPath();
  useEffect(() => {
    // Server-side logs already have the full stack via Next's own reporting;
    // this just makes the digest visible in the browser console for support.
    console.error('[app error boundary]', error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sf-red)_12%,transparent)]">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--sf-red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
      </div>
      <div>
        <p className="text-[var(--text-md)] font-semibold text-[var(--sf-label)]">Something went wrong loading this page</p>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--sf-label3)]">
          Try again — if it keeps happening, contact your treasurer{error.digest ? ` and mention error ${error.digest}` : ''}.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--sf-blue)] text-[var(--text-sm)] font-semibold text-white hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
        <Link
          href={scoped('/payments')}
          className="h-9 px-4 flex items-center rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-sm)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04] transition-colors no-underline"
        >
          Go to Payments
        </Link>
      </div>
    </div>
  );
}
