import { Suspense } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { requirePaymentsAuth } from '../auth';
import ReconciliationBanner from '../ReconciliationBanner';
import BillsView from '../BillsView';

export const metadata = { title: 'Bills · Payments · Trezia' };

interface SearchParams {
  flat?: string; from?: string; to?: string; page?: string;
  status?: string; year?: string; month?: string; unpaid?: string;
}

export default async function BillsRoutePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return (
    <Suspense key={JSON.stringify(params)} fallback={<ListSkeleton />}>
      <BillsSection params={params} />
    </Suspense>
  );
}

async function BillsSection({ params }: { params: SearchParams }) {
  const auth = await requirePaymentsAuth();
  return (
    <div className="space-y-3">
      <PageHeader title="Payments" />
      <ReconciliationBanner societyId={auth.societyId} />
      <BillsView params={params} societyId={auth.societyId} societySlug={auth.societySlug} />
    </div>
  );
}
