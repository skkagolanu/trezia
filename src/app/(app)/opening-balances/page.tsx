export const metadata = { title: 'Opening Balances · Trezia' };

import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import { formatINR } from '@/lib/utils/currency';
import { fyLabel } from '@/lib/utils/period';
import AddOpeningBalanceForm from './AddOpeningBalanceForm';
import type { OpeningBalance } from '@/types/database';

export default async function OpeningBalancesPage() {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_write')) redirect('/access-denied');

  const supabase = await createClient();

  const { data: balancesRaw } = await supabase
    .from('opening_balances')
    .select('*')
    .order('fy_start_year', { ascending: false });

  const balances = (balancesRaw ?? []) as OpeningBalance[];

  return (
    <div className="flex flex-col">
      <PageHeader title="Opening Balances" />

      <div className="flex-1 p-6 space-y-6">
        <Card title="Record Opening Balance">
          <p className="mb-4 text-[13px] text-sf-label2">
            One authoritative opening balance per financial year — e.g. carried forward from a
            treasurer handover or confirmed by the outgoing auditor. Recording again for the same
            FY updates that year&rsquo;s record.
          </p>
          <AddOpeningBalanceForm />
        </Card>

        <Card title="Recorded Financial Years">
          {balances.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-black/[0.06] text-left">
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Financial Year</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Bank Balance</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Cash in Hand</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Total</th>
                    <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04]">
                  {balances.map((b, i) => (
                    <tr key={b.id} className={`hover:bg-sf-bg ${i === 0 ? 'font-medium' : ''}`}>
                      <td className="px-4 py-3.5 text-sf-label2 whitespace-nowrap">{fyLabel(b.fy_start_year)}</td>
                      <td className="px-4 py-3.5 text-right text-sf-label">{formatINR(Number(b.bank_balance))}</td>
                      <td className="px-4 py-3.5 text-right text-sf-label">{formatINR(Number(b.cash_in_hand))}</td>
                      <td className="px-4 py-3.5 text-right font-semibold text-sf-label">
                        {formatINR(Number(b.bank_balance) + Number(b.cash_in_hand))}
                      </td>
                      <td className="px-4 py-3.5 text-sf-label2 max-w-xs truncate">{b.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-[14px] text-sf-label3">
              No opening balances recorded yet. Add one above.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
