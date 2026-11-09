import { Suspense } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { requirePaymentsAuth } from '../auth';
import ReconciliationBanner from '../ReconciliationBanner';
import AttentionView from '../AttentionView';

export const metadata = { title: 'Attention · Payments · Trezia' };

interface SearchParams {
  cat?: string; page?: string;
}

export default async function AttentionRoutePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return (
    <Suspense key={JSON.stringify(params)} fallback={<ListSkeleton />}>
      <AttentionSection params={params} />
    </Suspense>
  );
}

async function AttentionSection({ params }: { params: SearchParams }) {
  const auth = await requirePaymentsAuth();

  return (
    <div className="space-y-3">
      <PageHeader title="Payments" />
      <ReconciliationBanner societyId={auth.societyId} />
      <AttentionView societyId={auth.societyId} societySlug={auth.societySlug} role={auth.role} params={params} />
    </div>
  );
}
