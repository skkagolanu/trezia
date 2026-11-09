export const metadata = { title: 'Balance Snapshots · Trezia' };

import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import AddSnapshotForm from './AddSnapshotForm';

export default async function BalanceSnapshotsPage() {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_write')) redirect('/access-denied');

  const supabase = await createClient();

  const { data: snapshots } = await supabase
    .from('balance_snapshots')
    .select('*')
    .order('snapshot_date', { ascending: false })
    .limit(50);

  const latest = snapshots?.[0];

  return (
    <div className="flex flex-col">
      <PageHeader title="Balance Snapshots" />

      <div className="flex-1 p-6 space-y-6">
        {latest && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-black/[0.07] bg-sf-surface p-5">
              <p className="text-[13px] text-sf-label2">Bank Balance</p>
              <p className="mt-2 text-[26px] font-bold tracking-tight text-sf-blue">
                {formatINR(Number(latest.bank_balance ?? 0))}
              </p>
              <p className="mt-0.5 text-[12px] text-sf-label3">as of {formatDate(latest.snapshot_date)}</p>
            </div>
            <div className="rounded-xl border border-black/[0.07] bg-sf-surface p-5">
              <p className="text-[13px] text-sf-label2">Cash in Hand</p>
              <p className="mt-2 text-[26px] font-bold tracking-tight text-sf-green">
                {formatINR(Number(latest.cash_in_hand ?? 0))}
              </p>
              <p className="mt-0.5 text-[12px] text-sf-label3">as of {formatDate(latest.snapshot_date)}</p>
            </div>
            <div className="rounded-xl border border-black/[0.07] bg-sf-surface p-5">
              <p className="text-[13px] text-sf-label2">Total</p>
              <p className="mt-2 text-[26px] font-bold tracking-tight text-sf-label">
                {formatINR(Number(latest.bank_balance ?? 0) + Number(latest.cash_in_hand ?? 0))}
              </p>
              <p className="mt-0.5 text-[12px] text-sf-label3">Bank + Cash</p>
            </div>
          </div>
        )}

        <Card title="Record New Snapshot">
          <AddSnapshotForm />
        </Card>

        <Card title="Snapshot History">
          {snapshots && snapshots.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-black/[0.06] text-left">
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Date</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Bank Balance</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Cash in Hand</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Total</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04]">
                  {snapshots.map((s, i) => (
                    <tr key={s.id} className={`hover:bg-sf-bg ${i === 0 ? 'font-medium' : ''}`}>
                      <td className="px-4 py-3.5 text-sf-label2 whitespace-nowrap">{formatDate(s.snapshot_date)}</td>
                      <td className="px-4 py-3.5 text-right text-sf-label">{formatINR(Number(s.bank_balance ?? 0))}</td>
                      <td className="px-4 py-3.5 text-right text-sf-label">{formatINR(Number(s.cash_in_hand ?? 0))}</td>
                      <td className="px-4 py-3.5 text-right font-semibold text-sf-label">
                        {formatINR(Number(s.bank_balance ?? 0) + Number(s.cash_in_hand ?? 0))}
                      </td>
                      <td className="px-4 py-3.5 text-sf-label2 max-w-xs truncate">{s.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-[14px] text-sf-label3">
              No snapshots recorded yet. Add one above.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
