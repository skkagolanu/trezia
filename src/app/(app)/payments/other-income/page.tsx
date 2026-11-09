import { Suspense } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { requirePaymentsAuth } from '../auth';
import ReconciliationBanner from '../ReconciliationBanner';
import OtherIncomeView from '../OtherIncomeView';

export const metadata = { title: 'Other Income · Payments · Trezia' };

interface SearchParams {
  period?: string; from?: string; to?: string; page?: string; category?: string;
}

export default async function OtherIncomeRoutePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return (
    <Suspense key={JSON.stringify(params)} fallback={<ListSkeleton />}>
      <OtherIncomeSection params={params} />
    </Suspense>
  );
}

async function OtherIncomeSection({ params }: { params: SearchParams }) {
  const auth = await requirePaymentsAuth();
  return (
    <div className="space-y-3">
      <PageHeader title="Payments" />
      <ReconciliationBanner societyId={auth.societyId} />
      <OtherIncomeView params={params} societyId={auth.societyId} societySlug={auth.societySlug} />
    </div>
  );
}
