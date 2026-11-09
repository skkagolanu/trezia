import { Suspense } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { ReportsSkeleton } from '@/components/ui/Skeleton';
import ReportsContent from './ReportsContent';

export const metadata = { title: 'Reports · Trezia' };

interface SearchParams {
  fy?: string; q?: string; show?: string;
  period?: string; from?: string; to?: string;
}

// Split out of /payments — Reports was a collapsible section sharing a page
// with the transactional payments list; it's now its own route + TopNav item,
// keeping voucher entry separate from Display/Reports at the top level.
export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Thin shell — auth + all fetching live inside ReportsContent so the skeleton
  // shows immediately on a filter change (see the note in ReportsContent).
  const params = await searchParams;

  return (
    <div className="space-y-3">
      <PageHeader title="Reports" />
      {/* key on the filter params so a period/FY change re-shows the skeleton
          immediately — a searchParam navigation otherwise keeps stale content
          on screen with no pending UI while the server re-renders (3–5s). */}
      <Suspense key={JSON.stringify(params)} fallback={<ReportsSkeleton />}>
        <ReportsContent fy={params.fy} q={params.q} show={params.show} period={params.period} from={params.from} to={params.to} />
      </Suspense>
    </div>
  );
}
