import Link from 'next/link';
import EmptyState from '@/components/ui/EmptyState';
import FilterBar from '@/components/ui/FilterBar';
import Tooltip from '@/components/ui/Tooltip';
import Badge, { billStatusBadge } from '@/components/ui/Badge';
import VoidButton from '@/components/ui/VoidButton';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils/currency';
import { formatDate, formatMonthYear } from '@/lib/utils/date';
import { societyApiPath, societyPath } from '@/lib/society-path';
import type { BillStatus } from '@/types/database';
import TypeChips from './TypeChips';

const PAGE_SIZE = 50;
const BILL_STATUS_OPTIONS: BillStatus[] = ['DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED'];

interface BillsSearchParams {
  flat?: string; from?: string; to?: string; page?: string;
  status?: string; year?: string; month?: string; unpaid?: string;
}

// Invoiced bills, independent of when/whether they were paid — distinct from
// the payment-record views (default /payments and /payments/levies).
export default async function BillsView({ params, societyId, societySlug }: { params: BillsSearchParams; societyId: string; societySlug: string | null }) {
  const supabase = await createClient();
  const page   = Math.max(1, Number(params.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from('bills')
    .select('id, invoice_number, bill_period_year, bill_period_month, status, base_amount, payable_amount, due_date, is_voided, units!bills_unit_same_society(flat_number)', { count: 'exact' })
    .eq('society_id', societyId)
    .order('bill_period_year', { ascending: false })
    .order('bill_period_month', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (params.flat) {
    const { data: mu } = await supabase.from('units').select('id').eq('society_id', societyId).ilike('flat_number', params.flat);
    const ids = (mu ?? []).map(u => u.id);
    query = ids.length > 0 ? query.in('unit_id', ids) : query.in('unit_id', ['00000000-0000-0000-0000-000000000000']);
  }
  if (params.unpaid === '1') query = query.in('status', ['ISSUED', 'OVERDUE']);
  else if (params.status)    query = query.eq('status', params.status as BillStatus);
  if (params.year)   query = query.eq('bill_period_year', Number(params.year));
  if (params.month)  query = query.eq('bill_period_month', Number(params.month));
  if (params.from)   query = query.gte('due_date', params.from);
  if (params.to)     query = query.lte('due_date', params.to);

  const { data: bills, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  const currentYear  = new Date().getFullYear();
  const yearOptions  = Array.from({ length: 8 }, (_, i) => ({ value: String(currentYear - 2 + i), label: String(currentYear - 2 + i) }));
  const monthOptions = [
    { value: '4', label: 'Apr' }, { value: '5', label: 'May' }, { value: '6', label: 'Jun' },
    { value: '7', label: 'Jul' }, { value: '8', label: 'Aug' }, { value: '9', label: 'Sep' },
    { value: '10', label: 'Oct' }, { value: '11', label: 'Nov' }, { value: '12', label: 'Dec' },
    { value: '1', label: 'Jan' }, { value: '2', label: 'Feb' }, { value: '3', label: 'Mar' },
  ];

  function buildLink(overrides: Record<string, string | undefined>) {
    const merged: Record<string, string> = {};
    if (params.flat)   merged.flat   = params.flat;
    if (params.status) merged.status = params.status;
    if (params.unpaid) merged.unpaid = params.unpaid;
    if (params.year)   merged.year   = params.year;
    if (params.month)  merged.month  = params.month;
    if (params.from)   merged.from   = params.from;
    if (params.to)     merged.to     = params.to;
    merged.page = String(page);
    Object.assign(merged, overrides);
    const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v !== undefined && v !== '') as [string, string][]);
    return societyPath(societySlug, `/payments/bills?${qs}`);
  }

  const isUnpaidOnly = params.unpaid === '1';
  const hasFilters = !!(params.flat || params.status || params.unpaid || params.year || params.month || params.from || params.to);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <TypeChips active="bills" societySlug={societySlug} />
        <Link data-society-write href={societyPath(societySlug, '/bills/generate')} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--sf-blue)] px-3 text-[var(--text-sm)] font-semibold text-white hover:opacity-90 transition-opacity no-underline">
          Generate Bills
        </Link>
      </div>

      <div className="flex items-center gap-2">
        {count != null && <p className="text-[var(--text-sm)] text-[var(--sf-label2)]">{count} bills</p>}
        <Link
          href={buildLink({ unpaid: isUnpaidOnly ? undefined : '1', status: isUnpaidOnly ? params.status : undefined, page: '1' })}
          className={`h-7 px-3 flex items-center rounded-[var(--radius-md)] text-[var(--text-xs)] font-medium transition-colors no-underline whitespace-nowrap ${
            isUnpaidOnly
              ? 'bg-[rgba(192,57,43,0.10)] text-[var(--sf-red)]'
              : 'border border-[var(--sf-border)] text-[var(--sf-label2)] hover:bg-black/[0.04]'
          }`}
        >
          {isUnpaidOnly ? '✓ Unpaid only' : 'Unpaid only'}
        </Link>
      </div>

      <FilterBar
        keep={['unpaid']}
        fields={[
          { type: 'text' as const, name: 'flat', placeholder: 'Flat e.g. 101', widthClass: 'w-24' },
          ...(isUnpaidOnly ? [] : [{ type: 'select' as const, name: 'status', placeholder: 'All statuses', options: BILL_STATUS_OPTIONS.map(s => ({ value: s, label: s })) }]),
          { type: 'select' as const, name: 'year', placeholder: 'All years', options: yearOptions.map(y => ({ value: String(y.value), label: y.label })) },
          { type: 'select' as const, name: 'month', placeholder: 'All months', options: monthOptions.map(m => ({ value: String(m.value), label: m.label })) },
          { type: 'date' as const, name: 'from' },
          { type: 'date' as const, name: 'to' },
        ]}
      />

      <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] overflow-hidden">
        {bills && bills.length > 0 ? (
        <div className="overflow-x-auto sticky-thead">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--sf-divider)]">
                {['Invoice #', 'Flat', 'Period', 'Status', 'Base', 'Total', 'Due Date', ''].map((h, i) => (
                  <th key={h || i} className={`h-8 px-3 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] whitespace-nowrap ${['Base', 'Total'].includes(h) ? 'text-right' : 'text-left'}`}>
                    {h === 'Status' ? (
                      <span className="inline-flex items-center gap-1">
                        {h}
                        <Tooltip text="ISSUED: bill generated, payment not yet received. PAID: fully settled. OVERDUE: past the due date without payment." />
                      </span>
                    ) : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--sf-divider)]">
              {bills.map(bill => {
                const unit = bill.units as unknown as { flat_number: string } | null;
                return (
                  <tr key={bill.id} className={`group transition-colors text-[var(--text-sm)] ${bill.is_voided ? 'opacity-50' : 'hover:bg-[var(--sf-bg)]'}`}>
                    <td className="px-3 py-2.5 font-mono text-[var(--text-xs)] text-[var(--sf-label2)] whitespace-nowrap">{bill.invoice_number}</td>
                    <td className="px-3 py-2.5 font-semibold text-[var(--sf-label)]">{unit?.flat_number ?? '—'}</td>
                    <td className="px-3 py-2.5 text-[var(--sf-label2)] whitespace-nowrap">{formatMonthYear(bill.bill_period_year, bill.bill_period_month)}</td>
                    <td className="px-3 py-2.5">
                      {bill.is_voided ? <Badge color="red">Voided</Badge> : <Badge color={billStatusBadge(bill.status)}>{bill.status}</Badge>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[var(--sf-label2)]">{formatINR(Number(bill.base_amount))}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-[var(--sf-label)]">{formatINR(Number(bill.payable_amount))}</td>
                    <td className="px-3 py-2.5 text-[var(--sf-label2)] whitespace-nowrap">{formatDate(bill.due_date)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 sm:transition-opacity sm:duration-100 max-sm:opacity-100">
                        <a href={societyApiPath(`/s/${societySlug ?? ''}`, `/api/pdf/bill?bill_id=${bill.id}`)} target="_blank" rel="noopener noreferrer" className="text-[var(--text-xs)] font-medium text-[var(--sf-blue)] hover:underline">PDF</a>
                        {!bill.is_voided && <VoidButton id={bill.id} endpoint="/api/bills" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        ) : (
          <EmptyState
            icon={
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="4" y="4" width="16" height="16" rx="2"/>
                <path d="M8 2v4M16 2v4M4 10h16"/>
              </svg>
            }
            heading={hasFilters ? 'No bills match these filters' : 'No bills generated yet'}
            body={hasFilters ? 'Try adjusting your filters.' : 'Generate bills for each month to start tracking payments and dues.'}
            action={{ label: 'Generate Bills →', href: societyPath(societySlug, '/bills/generate') }}
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
