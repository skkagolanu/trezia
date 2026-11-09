export const metadata = { title: 'Fund Ledger · Trezia' };

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import VoidButton from '@/components/ui/VoidButton';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import AddFundEntryForm from './AddFundEntryForm';
import type { FundLedgerEntry, FundType } from '@/types/database';
import { societyPath } from '@/lib/society-path';

export default async function FundLedgerPage({ searchParams }: { searchParams: Promise<{ fund_type?: string }> }) {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_write')) redirect('/access-denied');

  const params = await searchParams;
  const fundType: FundType = params.fund_type === 'SINKING' ? 'SINKING' : 'CORPUS';

  const supabase = await createClient();
  const { data: entriesRaw } = await supabase
    .from('fund_ledger_entries')
    .select('*')
    .eq('fund_type', fundType)
    .eq('is_voided', false)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false });

  const entries = (entriesRaw ?? []) as FundLedgerEntry[];
  const balance = entries.reduce((s, e) => s + (e.entry_type === 'OUTFLOW' ? -e.amount : e.amount), 0);

  const tabCls = (active: boolean) =>
    `h-8 px-3 flex items-center rounded-[var(--radius-md)] text-[var(--text-sm)] font-medium transition-all no-underline ${
      active ? 'bg-[var(--sf-label)] text-white' : 'border border-[var(--sf-border)] text-[var(--sf-label2)] hover:bg-black/[0.04]'
    }`;

  return (
    <div className="flex flex-col">
      <PageHeader title="Fund Ledger" />

      <div className="flex-1 p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5">
            <Link href={societyPath(auth.societySlug, '/fund-ledger?fund_type=CORPUS')} className={tabCls(fundType === 'CORPUS')}>Corpus Fund</Link>
            <Link href={societyPath(auth.societySlug, '/fund-ledger?fund_type=SINKING')} className={tabCls(fundType === 'SINKING')}>Sinking Fund</Link>
          </div>
          <div className="rounded-xl border border-black/[0.07] bg-sf-surface px-5 py-2.5">
            <p className="text-[12px] text-sf-label2">Current Balance</p>
            <p className="text-[20px] font-bold tracking-tight text-sf-label">{formatINR(balance)}</p>
          </div>
        </div>

        <Card title="Record Entry">
          <AddFundEntryForm fundType={fundType} />
        </Card>

        <Card title="Ledger History">
          {entries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-black/[0.06] text-left">
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Date</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Type</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Amount</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Notes</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04]">
                  {entries.map(e => (
                    <tr key={e.id} className="group hover:bg-sf-bg">
                      <td className="px-4 py-3.5 text-sf-label2 whitespace-nowrap">{formatDate(e.entry_date)}</td>
                      <td className="px-4 py-3.5">
                        <Badge color={e.entry_type === 'OUTFLOW' ? 'red' : 'green'}>{e.entry_type}</Badge>
                      </td>
                      <td className={`px-4 py-3.5 text-right font-semibold ${e.entry_type === 'OUTFLOW' ? 'text-sf-red' : 'text-sf-green'}`}>
                        {e.entry_type === 'OUTFLOW' ? '−' : '+'}{formatINR(e.amount)}
                      </td>
                      <td className="px-4 py-3.5 text-sf-label2 max-w-xs truncate">{e.notes ?? '—'}</td>
                      <td className="px-4 py-3.5">
                        <div className="opacity-0 group-hover:opacity-100 sm:transition-opacity sm:duration-100 max-sm:opacity-100">
                          <VoidButton id={e.id} endpoint="/api/fund-ledger" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-[14px] text-sf-label3">
              No {fundType.toLowerCase()} fund entries yet. Add one above.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
