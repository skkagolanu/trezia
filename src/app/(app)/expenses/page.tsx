export const metadata = { title: 'Expenses · Trezia' };

import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { redirect } from 'next/navigation';
import { ListSkeleton } from '@/components/ui/Skeleton';
import Card from '@/components/ui/Card';
import Link from 'next/link';
import type { ExpenseCategory, Expenditure } from '@/types/database';
import { CATEGORY_LABELS } from '@/lib/constants/categories';
import { formatINR } from '@/lib/utils/currency';
import { fyOptions, resolvePeriod, type PeriodKey } from '@/lib/utils/period';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import ExpensesTableBody from './ExpensesTableBody';
import FilterBar from '@/components/ui/FilterBar';
import PeriodChips from '@/components/ui/PeriodChips';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { societyPath } from '@/lib/society-path';

const PAGE_SIZE = 50;

type ExpensesSP = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function ExpensesPage({ searchParams }: { searchParams: ExpensesSP }) {
  const params = await searchParams;
  return (
    <Suspense key={JSON.stringify(params)} fallback={<ListSkeleton />}>
      <ExpensesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ExpensesContent({
  searchParams,
}: {
  searchParams: ExpensesSP;
}) {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_read')) redirect('/access-denied');

  const sp = await searchParams;

  const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  const category = str(sp.category) ?? '';
  const payee    = str(sp.payee)?.trim() ?? '';
  const amountMin = str(sp.amountMin);
  const amountMax = str(sp.amountMax);
  const pageNum  = typeof sp.page === 'string' ? Math.max(1, parseInt(sp.page, 10)) : 1;

  const supabase = await createClient();
  const now = new Date();

  // Any period, not just FY: This Month (default) · any FY · All Time · custom dates
  const resolved = resolvePeriod(
    { period: str(sp.period), from: str(sp.from), to: str(sp.to), fy: str(sp.fy) },
    { defaultKey: 'month', now },
  );

  function makeUrl(o: { cat?: string; p?: number }) {
    const nc = 'cat' in o ? o.cat : category;
    const np = o.p ?? 1;
    const p = new URLSearchParams();
    const period = str(sp.period);
    if (period)      p.set('period', period);
    if (str(sp.fy))  p.set('fy', str(sp.fy)!);
    if (str(sp.from)) p.set('from', str(sp.from)!);
    if (str(sp.to))   p.set('to', str(sp.to)!);
    if (nc)          p.set('category', nc);
    if (payee)       p.set('payee', payee);
    if (amountMin)   p.set('amountMin', amountMin);
    if (amountMax)   p.set('amountMax', amountMax);
    if (np > 1)      p.set('page', String(np));
    return societyPath(auth.societySlug, `/expenses${p.size ? '?' + p.toString() : ''}`);
  }

  const from = (pageNum - 1) * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;

  // Fetch every matching row for accurate category totals.
  const totalRows = await fetchAll<{ amount: number }>((f, t) => {
    let q = supabase.from('expenditures').select('amount').eq('is_voided', false)
      .order('id').range(f, t);
    if (resolved.from) q = q.gte('expense_date', resolved.from);
    if (resolved.to)   q = q.lte('expense_date', resolved.to);
    if (category)      q = q.eq('category', category as ExpenseCategory);
    if (payee)         q = q.ilike('payee_name', `%${payee}%`);
    if (amountMin)      q = q.gte('amount', Number(amountMin));
    if (amountMax)      q = q.lte('amount', Number(amountMax));
    return q;
  });

  let listQ = supabase.from('expenditures')
    .select('*', { count: 'exact' })
    .order('expense_date', { ascending: false })
    .range(from, to);
  if (resolved.from) listQ = listQ.gte('expense_date', resolved.from);
  if (resolved.to)   listQ = listQ.lte('expense_date', resolved.to);
  if (category)      listQ = listQ.eq('category', category as ExpenseCategory);
  if (payee)         listQ = listQ.ilike('payee_name', `%${payee}%`);
  if (amountMin)      listQ = listQ.gte('amount', Number(amountMin));
  if (amountMax)      listQ = listQ.lte('amount', Number(amountMax));

  const { data: expenses, count } = await listQ;
  const periodTotal = totalRows.reduce((s, e) => s + Number(e.amount), 0);
  const totalPages  = Math.ceil((count ?? 0) / PAGE_SIZE);

  const anyFilter = resolved.key !== 'all' || !!category || !!payee || !!amountMin || !!amountMax;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Expenses"
        action={
          <Link
            data-society-write
            href={societyPath(auth.societySlug, '/expenses/new')}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--sf-blue)] px-4 text-[var(--text-sm)] font-semibold text-white hover:opacity-90 transition-opacity"
          >
            + Add Expense
          </Link>
        }
      />

      <Card>
        {/* Filters: period chips (any FY / custom range) + category */}
        <div className="space-y-3 mb-5">
          <div className="flex flex-wrap items-center gap-3">
            <PeriodChips
              basePath={societyPath(auth.societySlug, '/expenses')}
              keep={{ category: category || undefined, payee: payee || undefined, amountMin, amountMax }}
              active={resolved.key as PeriodKey}
              activeFy={resolved.key === 'fy' ? (str(sp.fy) ?? fyOptions(now).at(-1)!.value) : undefined}
              fyOptions={fyOptions(now)}
              from={str(sp.from)}
              to={str(sp.to)}
            />
            {periodTotal > 0 && (
              <span className="ml-auto text-[var(--text-sm)] font-semibold text-[var(--sf-label2)]">
                {resolved.label} — {formatINR(periodTotal)}
              </span>
            )}
          </div>

          {resolved.key === 'custom' && (
            <FilterBar
              keep={['period', 'category', 'payee', 'amountMin', 'amountMax']}
              fields={[
                { type: 'date' as const, name: 'from' },
                { type: 'date' as const, name: 'to' },
              ]}
            />
          )}

          <FilterBar
            keep={['period', 'fy', 'from', 'to']}
            fields={[
              { type: 'select' as const, name: 'category', placeholder: 'All categories', options: Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })) },
              { type: 'text' as const, name: 'payee', placeholder: 'Payee name', widthClass: 'w-36' },
              { type: 'number' as const, name: 'amountMin', placeholder: 'Min ₹', widthClass: 'w-20' },
              { type: 'number' as const, name: 'amountMax', placeholder: 'Max ₹', widthClass: 'w-20' },
            ]}
          />
        </div>

        {/* Result count when filtered */}
        {anyFilter && expenses && expenses.length > 0 && (
          <p className="text-[var(--text-xs)] text-[var(--sf-label3)] mb-2">
            Showing <strong className="text-[var(--sf-label)]">{count}</strong> result{count !== 1 ? 's' : ''} — {resolved.label}
          </p>
        )}

        {/* Table */}
        {expenses && expenses.length > 0 ? (
          <div className="overflow-x-auto sticky-thead">
            <table className="w-full text-[var(--text-sm)]">
              <ExpensesTableBody expenses={expenses as Expenditure[]} />
            </table>
          </div>
        ) : (
          <EmptyState
            icon={
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/>
                <path d="M9 12h6M9 16h4"/>
              </svg>
            }
            heading={anyFilter ? 'No expenses match these filters' : 'No expenses recorded'}
            body={anyFilter ? 'Try a different period or category — This Month is the default view.' : 'Track society expenses here — lift maintenance, generator, cleaning, and more.'}
            action={anyFilter ? { label: 'Show all time', href: societyPath(auth.societySlug, '/expenses?period=all') } : { label: '+ Record Expense', href: societyPath(auth.societySlug, '/expenses/new') }}
          />
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-[var(--text-xs)] text-sf-label2">
              Page {pageNum} of {totalPages} ({count} total)
            </p>
            <div className="flex gap-2">
              {pageNum > 1 && (
                <Link
                  href={makeUrl({ p: pageNum - 1 })}
                  className="rounded-[var(--radius-md)] border border-black/[0.12] px-3 py-1.5 text-[var(--text-xs)] font-medium text-sf-label2 hover:bg-sf-bg transition-colors"
                >
                  Previous
                </Link>
              )}
              {pageNum < totalPages && (
                <Link
                  href={makeUrl({ p: pageNum + 1 })}
                  className="rounded-[var(--radius-md)] border border-black/[0.12] px-3 py-1.5 text-[var(--text-xs)] font-medium text-sf-label2 hover:bg-sf-bg transition-colors"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
