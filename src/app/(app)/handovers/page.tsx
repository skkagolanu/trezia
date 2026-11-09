export const metadata = { title: 'Handovers · Trezia' };

import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { requireFinancialReader } from '@/lib/supabase/require-auth';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import type { TreasurerHandover } from '@/types/database';
import HandoverForm from '@/components/handovers/HandoverForm';

// Thin shell — auth + data fetching live inside HandoversSection so the
// skeleton shows immediately on navigation, mirroring /payments and /reports.
export default async function HandoversPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  return (
    <Suspense fallback={<TableSkeleton />}>
      <HandoversSection page={Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1)} />
    </Suspense>
  );
}

async function HandoversSection({ page }: { page: number }) {
  const auth = await requireFinancialReader();
  if (auth.unauthorized?.status === 401) redirect('/login');
  if (auth.unauthorized) redirect('/access-denied');

  const supabase = await createClient();

  const pageSize = 25;
  const { data: handoversRaw, error } = await supabase
    .from('treasurer_handovers')
    .select('*')
    .order('handover_date', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const handovers = (handoversRaw ?? []) as TreasurerHandover[];

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Treasurer Handovers"
        subtitle="Keep an accountable record of balances and unfinished work when responsibility changes."
        count={handovers.length}
        countLabel={handovers.length === 1 ? 'record' : 'records'}
        action={!error ? <div className="w-full sm:w-auto"><HandoverForm mode="create" /></div> : undefined}
      />

      <div className="flex-1 space-y-4 py-3 sm:space-y-6">
        {error ? <Card><p role="alert" className="py-6 text-center text-[13px] text-sf-red">Handover records could not be loaded. Refresh before creating or editing a handover.</p></Card> : handovers.length > 0 ? (
          handovers.map((h) => (
            <Card key={h.id} title={`Handover — ${formatDate(h.handover_date)}`} action={<HandoverForm mode="edit" handover={h} />}>
              <div className="mb-5 grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-[12px] text-sf-label3 uppercase tracking-wide">Outgoing</p>
                  <p className="mt-1 text-[16px] font-semibold text-sf-label">{h.outgoing_treasurer}</p>
                </div>
                <div>
                  <p className="text-[12px] text-sf-label3 uppercase tracking-wide">Incoming</p>
                  <p className="mt-1 text-[16px] font-semibold text-sf-label">{h.incoming_treasurer}</p>
                </div>
                <div>
                  <p className="text-[12px] text-sf-label3 uppercase tracking-wide">Bank Balance</p>
                  <p className={`mt-1 text-[20px] font-bold tracking-tight ${h.bank_balance != null ? 'text-sf-blue' : 'text-sf-label3'}`}>
                    {h.bank_balance != null ? formatINR(Number(h.bank_balance)) : 'Not recorded'}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] text-sf-label3 uppercase tracking-wide">Cash in Hand</p>
                  <p className={`mt-1 text-[20px] font-bold tracking-tight ${h.cash_in_hand != null ? 'text-sf-green' : 'text-sf-label3'}`}>
                    {h.cash_in_hand != null ? formatINR(Number(h.cash_in_hand)) : 'Not recorded'}
                  </p>
                </div>
              </div>

              {h.outstanding_receivables_note && (
                <div className="mb-4 rounded-xl bg-sf-orange/[0.08] border border-sf-orange/20 px-4 py-3">
                  <p className="text-[12px] font-semibold text-sf-orange uppercase tracking-wide mb-1">Outstanding / Receivables</p>
                  <p className="text-[13px] text-sf-label">{h.outstanding_receivables_note}</p>
                </div>
              )}

              {h.notes && (
                <div className="rounded-xl bg-black/[0.03] px-4 py-3">
                  <p className="text-[12px] font-semibold text-sf-label3 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-[13px] text-sf-label2">{h.notes}</p>
                </div>
              )}

              <p className="mt-4 text-[12px] text-sf-label3">Recorded {formatDate(h.handover_date)} · Changes are retained in the audit log.</p>
            </Card>
          ))
        ) : (
          <Card>
            <div className="space-y-3 py-8 text-center">
              <p className="text-[14px] font-medium text-sf-label">No handover records yet</p>
              <p className="mx-auto max-w-md text-[13px] text-sf-label3">Record the outgoing and incoming treasurers, confirmed balances, and anything still outstanding.</p>
            </div>
          </Card>
        )}
        {!error && (page > 1 || handovers.length === pageSize) && <nav aria-label="Handover pagination" className="flex justify-between border-t border-sf-divider pt-3 text-[13px]"><span>Page {page}</span><span className="flex gap-3">{page > 1 && <a href={`?page=${page - 1}`} className="text-sf-blue">Previous</a>}{handovers.length === pageSize && <a href={`?page=${page + 1}`} className="text-sf-blue">Next</a>}</span></nav>}
      </div>
    </div>
  );
}
