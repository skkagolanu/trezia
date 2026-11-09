export const metadata = { title: 'Reconcile Statement · Trezia' };

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import { loadBatchWithCandidates } from '@/lib/reports/bank-reconciliation';
import LineActions from './LineActions';
import UndoButton from './UndoButton';

export default async function ReconcileBatchPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ page?: string }> }) {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_write')) redirect('/access-denied');

  const { batchId } = await params;
  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const supabase = await createClient();
  const result = await loadBatchWithCandidates(supabase, batchId, { page, limit: 50 });
  if (!result) notFound();

  const { batch, lines, pagination } = result;
  const unresolved = lines.filter(l => !l.matched_id && !l.is_ignored);
  const matched = lines.filter(l => l.matched_id);
  const ignored = lines.filter(l => l.is_ignored);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Reconcile Statement"
        countLabel={`Page ${pagination.page} · ${pagination.total} statement lines`}
      />

      <div className="flex-1 p-6 space-y-6">
        <p className="text-[13px] text-sf-label2">
          {batch.filename ?? 'Statement'} — {batch.statement_from && batch.statement_to ? `${formatDate(batch.statement_from)} – ${formatDate(batch.statement_to)}` : ''}
        </p>

        <Card title={`Unresolved (${unresolved.length})`}>
          {unresolved.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-black/[0.06] text-left">
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Date</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Description</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Amount</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Suggested Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04]">
                  {unresolved.map(line => (
                    <tr key={line.id} className="hover:bg-sf-bg">
                      <td className="px-4 py-3.5 text-sf-label2 whitespace-nowrap">{formatDate(line.line_date)}</td>
                      <td className="px-4 py-3.5 text-sf-label max-w-xs truncate">{line.description}</td>
                      <td className={`px-4 py-3.5 text-right font-semibold ${line.amount < 0 ? 'text-sf-red' : 'text-sf-green'}`}>
                        {formatINR(Math.abs(line.amount))}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <LineActions batchId={batch.id} lineId={line.id} candidates={line.candidates} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-6 text-center text-[14px] text-sf-label3">
              Every line is matched or ignored — this statement is fully reconciled.
            </p>
          )}
        </Card>

        {(matched.length > 0 || ignored.length > 0) && (
          <Card title="Resolved">
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-black/[0.06] text-left">
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Date</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Description</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Amount</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04]">
                  {[...matched, ...ignored].map(line => (
                    <tr key={line.id} className="hover:bg-sf-bg">
                      <td className="px-4 py-3.5 text-sf-label2 whitespace-nowrap">{formatDate(line.line_date)}</td>
                      <td className="px-4 py-3.5 text-sf-label max-w-xs truncate">{line.description}</td>
                      <td className="px-4 py-3.5 text-right text-sf-label">{formatINR(Math.abs(line.amount))}</td>
                      <td className="px-4 py-3.5">
                        {line.matched_id ? <Badge color="green">Matched</Badge> : <Badge color="gray">Ignored</Badge>}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <UndoButton batchId={batch.id} lineId={line.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {(pagination.page > 1 || pagination.hasMore) && (
          <nav aria-label="Statement lines" className="flex items-center justify-between text-[13px] text-sf-label2">
            <span>Page {pagination.page}</span>
            <span className="flex gap-3">
              {pagination.page > 1 && <a className="text-sf-blue" href={`?page=${pagination.page - 1}`}>Previous</a>}
              {pagination.hasMore && <a className="text-sf-blue" href={`?page=${pagination.page + 1}`}>Next</a>}
            </span>
          </nav>
        )}
      </div>
    </div>
  );
}
