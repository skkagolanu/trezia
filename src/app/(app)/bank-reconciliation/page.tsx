export const metadata = { title: 'Bank Reconciliation · Trezia' };

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import { formatDate } from '@/lib/utils/date';
import UploadStatementForm from './UploadStatementForm';
import type { BankStatementBatch } from '@/types/database';
import { societyPath } from '@/lib/society-path';

export default async function BankReconciliationPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_write')) redirect('/access-denied');

  const supabase = await createClient();
  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const pageSize = 50;
  const { data: batchesRaw, error, count } = await supabase
    .from('bank_statement_batches')
    .select('*', { count: 'exact' })
    .order('uploaded_at', { ascending: false })
    .order('id', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const batches = (batchesRaw ?? []) as BankStatementBatch[];

  return (
    <div className="flex flex-col">
      <PageHeader title="Bank Reconciliation" />

      <div className="flex-1 p-6 space-y-6">
        <p className="text-[13px] text-sf-label2 max-w-2xl">
          Import a bank statement CSV, then match each transaction against a recorded payment,
          AMC collection, other income entry, or expense. Suggested matches are based on exact
          amount + a 3-day date window — you confirm every match, nothing is matched automatically.
        </p>

        <Card title="Import Statement">
          <UploadStatementForm />
        </Card>

        <Card title="Import History">
          {error ? (
            <p role="alert" className="py-8 text-center text-[14px] text-sf-red">Statement history could not be loaded.</p>
          ) : batches.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-black/[0.06] text-left">
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Uploaded</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">File</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Period</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Lines</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04]">
                  {batches.map(b => (
                    <tr key={b.id} className="hover:bg-sf-bg">
                      <td className="px-4 py-3.5 text-sf-label2 whitespace-nowrap">
                        {new Date(b.uploaded_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3.5 text-sf-label">{b.filename ?? '—'}</td>
                      <td className="px-4 py-3.5 text-sf-label2 whitespace-nowrap">
                        {b.statement_from && b.statement_to ? `${formatDate(b.statement_from)} – ${formatDate(b.statement_to)}` : '—'}
                      </td>
                      <td className="px-4 py-3.5 text-right text-sf-label">{b.line_count}</td>
                      <td className="px-4 py-3.5 text-right">
                        <Link href={societyPath(auth.societySlug, `/bank-reconciliation/${b.id}`)} className="text-[13px] font-medium text-sf-blue hover:underline">
                          Review →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-[14px] text-sf-label3">
              No statements imported yet. Import one above.
            </p>
          )}
          {!error && (page > 1 || page * pageSize < (count ?? 0)) && (
            <nav aria-label="Statement imports" className="mt-4 flex justify-between text-[13px] text-sf-label2">
              <span>Page {page}</span>
              <span className="flex gap-3">
                {page > 1 && <Link className="text-sf-blue" href={societyPath(auth.societySlug, `/bank-reconciliation?page=${page - 1}`)}>Previous</Link>}
                {page * pageSize < (count ?? 0) && <Link className="text-sf-blue" href={societyPath(auth.societySlug, `/bank-reconciliation?page=${page + 1}`)}>Next</Link>}
              </span>
            </nav>
          )}
        </Card>
      </div>
    </div>
  );
}
