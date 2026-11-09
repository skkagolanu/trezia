import { Suspense } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { requirePaymentsAuth } from '../auth';
import ReconciliationBanner from '../ReconciliationBanner';
import LeviesView from '../LeviesView';

export const metadata = { title: 'AMC · Payments · Trezia' };

interface SearchParams {
  levy?: string; amcStatus?: string;
}

export default async function LeviesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return (
    <Suspense key={JSON.stringify(params)} fallback={<ListSkeleton />}>
      <LeviesSection params={params} />
    </Suspense>
  );
}

async function LeviesSection({ params }: { params: SearchParams }) {
  const auth = await requirePaymentsAuth();
  return (
    <div className="space-y-3">
      <PageHeader title="Payments" />
      <ReconciliationBanner societyId={auth.societyId} />
      <LeviesView params={params} societyId={auth.societyId} societySlug={auth.societySlug} />
    </div>
  );
}
