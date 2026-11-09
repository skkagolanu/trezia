import Link from 'next/link';
import EmptyState from '@/components/ui/EmptyState';
import FilterBar from '@/components/ui/FilterBar';
import PeriodChips from '@/components/ui/PeriodChips';
import Badge from '@/components/ui/Badge';
import VoidButton from '@/components/ui/VoidButton';
import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import { resolvePeriod, type PeriodKey } from '@/lib/utils/period';
import { societyPath } from '@/lib/society-path';
import type { IncomeCategory } from '@/types/database';
import { INCOME_CATEGORY_LABELS } from '@/lib/constants/categories';
import TypeChips from './TypeChips';

const PAGE_SIZE = 50;

interface OtherIncomeSearchParams {
  period?: string; from?: string; to?: string; page?: string; category?: string;
}

function listPeriod(params: OtherIncomeSearchParams) {
  return resolvePeriod({ period: params.period, from: params.from, to: params.to }, { defaultKey: 'month' });
}

// Non-maintenance income: ad board rent, penalty collections, corpus fund, etc.
export default async function OtherIncomeView({ params, societyId, societySlug }: { params: OtherIncomeSearchParams; societyId: string; societySlug: string | null }) {
  const supabase = await createClient();
  const page   = Math.max(1, Number(params.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;

  const resolved = listPeriod(params);
  const effectiveFrom = resolved.from;
  const effectiveTo   = resolved.to;

  let query = supabase
    .from('other_income')
    .select('*', { count: 'exact' })
    .eq('society_id', societyId)
    .order('income_date', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (params.category) query = query.eq('category', params.category as IncomeCategory);
  if (effectiveFrom)   query = query.gte('income_date', effectiveFrom);
  if (effectiveTo)     query = query.lte('income_date', effectiveTo);

  // Period total over the full filtered set — not just the visible page
  const [{ data: rows, count }, totalRows] = await Promise.all([query, fetchAll<{ id: string; amount: number }>((from, to) => {
    let totalQ = supabase.from('other_income').select('id, amount').eq('society_id', societyId).eq('is_voided', false);
    if (params.category) totalQ = totalQ.eq('category', params.category as IncomeCategory);
    if (effectiveFrom)   totalQ = totalQ.gte('income_date', effectiveFrom);
    if (effectiveTo)     totalQ = totalQ.lte('income_date', effectiveTo);
    return totalQ.order('income_date').order('id').range(from, to) as unknown as PromiseLike<{ data: Array<{ id: string; amount: number }> | null; error: { message: string } | null }>;
  })]);
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  const periodTotal = totalRows.reduce((s, r) => s + Number(r.amount), 0);

  function buildLink(overrides: Record<string, string | undefined>) {
    const merged: Record<string, string> = {};
    if (params.period)   merged.period   = params.period;
    if (params.from)     merged.from     = params.from;
    if (params.to)       merged.to       = params.to;
    if (params.category) merged.category = params.category;
    merged.page = String(page);
    Object.assign(merged, overrides);
    const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v !== undefined && v !== '') as [string, string][]);
    return societyPath(societySlug, `/payments/other-income?${qs}`);
  }

  const catOptions = Object.entries(INCOME_CATEGORY_LABELS).filter(([v]) => v !== 'MAINTENANCE');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <TypeChips active="other-income" societySlug={societySlug} />
        {periodTotal > 0 && (
          <span className="text-[var(--text-sm)] font-semibold text-sf-green">{formatINR(periodTotal)}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PeriodChips
          basePath={societyPath(societySlug, '/payments/other-income')}
          keep={{ category: params.category }}
          active={resolved.key as PeriodKey}
          from={params.from}
          to={params.to}
        />
      </div>

      {resolved.key === 'custom' && (
        <FilterBar
          keep={['period', 'category']}
          fields={[
            { type: 'date' as const, name: 'from' },
            { type: 'date' as const, name: 'to' },
          ]}
        />
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-1.5">
        <Link
          href={buildLink({ category: undefined, page: '1' })}
          className={`h-8 px-3 flex items-center rounded-[var(--radius-md)] text-[var(--text-sm)] font-medium transition-colors no-underline ${
            !params.category ? 'bg-[var(--sf-label)] text-white' : 'border border-[var(--sf-border)] text-[var(--sf-label3)] hover:text-[var(--sf-label2)]'
          }`}
        >
          All
        </Link>
        {catOptions.map(([val, label]) => (
          <Link
            key={val}
            href={buildLink({ category: params.category === val ? undefined : val, page: '1' })}
            className={`h-8 px-3 flex items-center rounded-[var(--radius-md)] text-[var(--text-sm)] font-medium transition-colors no-underline ${
              params.category === val ? 'bg-[var(--sf-label)] text-white' : 'border border-[var(--sf-border)] text-[var(--sf-label3)] hover:text-[var(--sf-label2)]'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] overflow-hidden">
        {rows && rows.length > 0 ? (
        <div className="overflow-x-auto sticky-thead">
          <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr className="border-b border-[var(--sf-divider)]">
                {['Date', 'Description', 'Category', 'Amount', 'Received Via', 'FY Treasurer', 'Notes', 'Status', ''].map((h, i) => (
                  <th key={h || i} className={`h-8 px-3 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] whitespace-nowrap ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--sf-divider)]">
              {rows.map(row => (
                <tr key={row.id} className={`group text-[var(--text-sm)] transition-colors ${row.is_voided ? 'opacity-50' : 'hover:bg-[var(--sf-bg)]'}`}>
                  <td className="px-3 py-2.5 text-[var(--sf-label2)] whitespace-nowrap">{formatDate(row.income_date)}</td>
                  <td className="px-3 py-2.5 text-[var(--sf-label)] max-w-[200px] truncate">{row.description}</td>
                  <td className="px-3 py-2.5">
                    <Badge color="blue">{INCOME_CATEGORY_LABELS[row.category as IncomeCategory] ?? row.category}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-[var(--sf-label)] tabular whitespace-nowrap">{formatINR(Number(row.amount))}</td>
                  <td className="px-3 py-2.5 text-[var(--sf-label2)]">{row.received_via ?? '—'}</td>
                  <td className="px-3 py-2.5 text-[var(--sf-label2)] whitespace-nowrap">{row.recorded_by ?? '—'}</td>
                  <td className="px-3 py-2.5 text-[var(--sf-label2)] max-w-[200px] truncate">{row.notes ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {row.is_voided ? <Badge color="red">Voided</Badge> : <Badge color="green">Active</Badge>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="opacity-0 group-hover:opacity-100 sm:transition-opacity sm:duration-100 max-sm:opacity-100">
                      {!row.is_voided && <VoidButton id={row.id} endpoint="/api/other-income" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : (
          <EmptyState
            icon={
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            }
            heading="No other income recorded"
            body="Track non-maintenance income here — ad board rent, penalty collections, corpus fund, and more."
          />
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--sf-divider)] px-4 py-2.5">
            <p className="text-[var(--text-xs)] text-[var(--sf-label2)]">Page {page} of {totalPages} — {count} total</p>
            <div className="flex gap-2">
              {page > 1 && <Link href={buildLink({ page: String(page - 1) })} className="h-7 flex items-center px-3 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-xs)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04] no-underline">Previous</Link>}
              {page < totalPages && <Link href={buildLink({ page: String(page + 1) })} className="h-7 flex items-center px-3 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-xs)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04] no-underline">Next</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
