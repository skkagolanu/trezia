import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { societyPath } from '@/lib/society-path';
import { requirePaymentsAuth } from './auth';
import { resolveLegacyTypeRedirect, type RawSearchParams } from './legacy-redirect';
import ReconciliationBanner from './ReconciliationBanner';
import AttentionSummaryLink from './AttentionSummaryLink';
import UnifiedView from './UnifiedView';

export const metadata = { title: 'Payments · Trezia' };

// Reports-only params — old /payments deep links carrying these with
// no `type` meant "show Reports"; that section now lives at /reports.
const REPORTS_ONLY_PARAMS = ['fy', 'q', 'show'] as const;

interface SearchParams {
  type?: string; // 'all' (default) | 'maintenance' — every other value now lives at its own route, see legacy-redirect.ts
  fy?: string; q?: string; show?: string;
  period?: string; flat?: string; from?: string; to?: string; page?: string;
  mode?: string; resident?: string; amountMin?: string; amountMax?: string;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  // Thin shell: only `await searchParams` (no network) runs before the Suspense
  // boundary, so a filter/tab change re-shows the skeleton IMMEDIATELY. All auth
  // and data fetching lives inside PaymentsSection — if it ran here it would
  // block the boundary and the skeleton would appear seconds late.
  const raw = await searchParams;
  return (
    <Suspense key={JSON.stringify(raw)} fallback={<ListSkeleton />}>
      <PaymentsSection raw={raw} />
    </Suspense>
  );
}

// ── Payments section content ──────────────────────────────────────────────────
async function PaymentsSection({ raw }: { raw: RawSearchParams }) {
  const auth = await requirePaymentsAuth();

  // `/payments?type=X` is a hard external contract for bookmarks and other
  // slices' hrefs — AMC/CMC, Bills, Other Income, and Attention each moved to
  // their own route. Forward permanently rather than breaking the link.
  const legacyTarget = resolveLegacyTypeRedirect(raw);
  if (legacyTarget) redirect(societyPath(auth.societySlug, legacyTarget));

  const params = raw as unknown as SearchParams;


  if (!params.type && REPORTS_ONLY_PARAMS.some(k => params[k])) {
    const qs = new URLSearchParams();
    for (const k of [...REPORTS_ONLY_PARAMS, 'period', 'from', 'to'] as const) {
      const v = params[k];
      if (v) qs.set(k, v);
    }
    redirect(societyPath(auth.societySlug, `/reports${qs.toString() ? `?${qs}` : ''}`));
  }

  const type = params.type === 'maintenance' ? 'maintenance' : 'all';

  return (
    <div className="space-y-3">
      <PageHeader title="Payments" />
      <ReconciliationBanner societyId={auth.societyId} />
      {/* Only shown on the default unified view, and only to a role that can
          see at least one attention category — AttentionSummaryLink checks both. */}
      {type === 'all' && <AttentionSummaryLink societyId={auth.societyId} societySlug={auth.societySlug} role={auth.role} />}
      <UnifiedView params={params} societyId={auth.societyId} societySlug={auth.societySlug} typeFilter={type} />
    </div>
  );
}
