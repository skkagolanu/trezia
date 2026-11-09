export const metadata = { title: 'Monthly Summary · Trezia' };

import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { roleHome } from '@/lib/auth/roles';
import { societyPath } from '@/lib/society-path';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { formatINR } from '@/lib/utils/currency';

type MonthlySummaryRow = {
  month_start: string | null;
  total_collected: number | string | null;
  total_spent: number | string | null;
};

function SummaryUnavailable() {
  return (
    <div className="space-y-5">
      <PageHeader title="Monthly Summary" />
      <div
        role="status"
        className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-6 text-[var(--text-sm)] text-[var(--sf-label2)]"
      >
        This month&apos;s society summary is unavailable right now. Please refresh and try again.
      </div>
    </div>
  );
}

export default async function SummaryPage() {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (auth.role !== 'resident') {
    redirect(societyPath(auth.societySlug, roleHome(auth.role)));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_resident_monthly_summary');
  if (error) return <SummaryUnavailable />;

  const row = (Array.isArray(data) ? data[0] : data) as MonthlySummaryRow | null | undefined;
  if (!row) return <SummaryUnavailable />;

  const totalCollected = Number(row.total_collected ?? 0);
  const totalSpent = Number(row.total_spent ?? 0);
  if (!Number.isFinite(totalCollected) || !Number.isFinite(totalSpent)) {
    return <SummaryUnavailable />;
  }

  const monthLabel = row.month_start
    ? new Date(`${row.month_start}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="Monthly Summary" />
        <p className="text-[var(--text-sm)] text-[var(--sf-label2)]">
          Society totals for {monthLabel}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 sm:p-5">
          <p className="text-[var(--text-xs)] font-medium text-[var(--sf-label3)]">Total collected</p>
          <p className="mt-1 break-words text-[var(--text-lg)] font-bold tabular-nums text-[var(--sf-green)]">
            {formatINR(totalCollected)}
          </p>
        </div>
        <div className="min-w-0 rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 sm:p-5">
          <p className="text-[var(--text-xs)] font-medium text-[var(--sf-label3)]">Total spent</p>
          <p className="mt-1 break-words text-[var(--text-lg)] font-bold tabular-nums text-[var(--sf-red)]">
            {formatINR(totalSpent)}
          </p>
        </div>
      </div>
    </div>
  );
}
