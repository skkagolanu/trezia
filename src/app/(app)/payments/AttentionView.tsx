import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { societyPath } from '@/lib/society-path';
import { formatDate } from '@/lib/utils/date';
import { classifyRenewals } from '@/lib/operations/renewals';
import { fetchAll } from '@/lib/supabase/fetch-all';
import {
  attentionCategory,
  isAttentionCategoryVisible,
  isBackupStale,
  isContractRenewalDue,
  visibleAttentionCategories,
  type AttentionCategoryDef,
  type AttentionCategoryKey,
} from '@/lib/attention/categories';
import type { AppRole } from '@/types/database';
import TypeChips from './TypeChips';

const PAGE_SIZE = 20;

interface AttentionItem {
  id: string;
  primary: string;
  secondary?: string;
  // Category-specific deep link into the correction workflow; falls back to the
  // category's own href when there is no per-row target.
  href?: string;
}

interface CategoryResult {
  count: number | null;
  items: AttentionItem[];
}

// Each loader returns the exact total count (never an array length — a category
// can exceed 200 rows) and, only when the category is focused, the page of
// items. A thrown/failed query returns count null so the tab can flag it rather
// than silently reporting zero.
async function loadPendingClaims(
  supabase: Awaited<ReturnType<typeof createClient>>,
  societyId: string,
  focused: boolean,
  offset: number,
): Promise<CategoryResult> {
  const countRes = await supabase
    .from('resident_payment_claims')
    .select('id', { count: 'exact', head: true })
    .eq('society_id', societyId)
    .eq('status', 'pending');
  if (countRes.error) return { count: null, items: [] };
  if (!focused) return { count: countRes.count ?? 0, items: [] };
  const listRes = await supabase
    .from('resident_payment_claims')
    .select('id, amount, submitted_at, units!resident_payment_claims_unit_same_society!inner(flat_number)')
    .eq('society_id', societyId)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);
  if (listRes.error) return { count: null, items: [] };
  const items = (listRes.data ?? []).map(row => {
    const unit = row.units as unknown as { flat_number?: string } | null;
    return {
      id: row.id,
      primary: `Flat ${unit?.flat_number ?? '—'} · ₹${Number(row.amount).toLocaleString('en-IN')}`,
      secondary: `Submitted ${formatDate(String(row.submitted_at).slice(0, 10))}`,
    };
  });
  return { count: countRes.count ?? 0, items };
}

async function loadGatewayReconciliation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  societyId: string,
  focused: boolean,
  offset: number,
): Promise<CategoryResult> {
  const countRes = await supabase
    .from('resident_payment_links')
    .select('id', { count: 'exact', head: true })
    .eq('society_id', societyId)
    .eq('reconciliation_required', true);
  if (countRes.error) return { count: null, items: [] };
  if (!focused) return { count: countRes.count ?? 0, items: [] };
  const listRes = await supabase
    .from('resident_payment_links')
    .select('id, amount, reconciliation_note, razorpay_payment_id, created_at, units!resident_payment_links_unit_id_fkey(flat_number)')
    .eq('society_id', societyId)
    .eq('reconciliation_required', true)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  if (listRes.error) return { count: null, items: [] };
  const items = (listRes.data ?? []).map(row => {
    const unit = row.units as unknown as { flat_number?: string } | null;
    return {
      id: row.id,
      primary: `Flat ${unit?.flat_number ?? '—'} · ₹${Number(row.amount).toLocaleString('en-IN')}`,
      secondary: row.reconciliation_note ?? row.razorpay_payment_id ?? 'Gateway settlement conflict',
    };
  });
  return { count: countRes.count ?? 0, items };
}

async function loadUnmatchedBankLines(
  supabase: Awaited<ReturnType<typeof createClient>>,
  societyId: string,
  focused: boolean,
  offset: number,
  societySlug: string | null,
): Promise<CategoryResult> {
  const batchesRes = await supabase
    .from('bank_statement_batches')
    .select('id')
    .eq('society_id', societyId);
  if (batchesRes.error) return { count: null, items: [] };
  const batchIds = (batchesRes.data ?? []).map(b => b.id);
  if (batchIds.length === 0) return { count: 0, items: [] };
  const countRes = await supabase
    .from('bank_statement_lines')
    .select('id', { count: 'exact', head: true })
    .in('batch_id', batchIds)
    .is('matched_id', null)
    .eq('is_ignored', false);
  if (countRes.error) return { count: null, items: [] };
  if (!focused) return { count: countRes.count ?? 0, items: [] };
  const listRes = await supabase
    .from('bank_statement_lines')
    .select('id, batch_id, line_date, description, amount')
    .in('batch_id', batchIds)
    .is('matched_id', null)
    .eq('is_ignored', false)
    .order('line_date', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  if (listRes.error) return { count: null, items: [] };
  const items = (listRes.data ?? []).map(row => ({
    id: row.id,
    primary: `${formatDate(String(row.line_date).slice(0, 10))} · ₹${Number(row.amount).toLocaleString('en-IN')}`,
    secondary: row.description ?? '',
    href: societyPath(societySlug, `/bank-reconciliation/${row.batch_id}`),
  }));
  return { count: countRes.count ?? 0, items };
}

async function loadMissingCurrentBills(
  supabase: Awaited<ReturnType<typeof createClient>>,
  societyId: string,
  now: Date,
  focused: boolean,
  offset: number,
): Promise<CategoryResult> {
  try {
    const [units, bills] = await Promise.all([
      fetchAll((from, to) => supabase
      .from('units')
      .select('id, flat_number')
      .eq('society_id', societyId)
      .eq('is_active', true)
      .eq('is_test_unit', false)
      .order('flat_number')
      .order('id')
      .range(from, to)),
      fetchAll((from, to) => supabase
      .from('bills')
      .select('unit_id')
      .eq('society_id', societyId)
      .eq('bill_period_year', now.getFullYear())
      .eq('bill_period_month', now.getMonth() + 1)
      .eq('is_voided', false)
      .order('unit_id')
      .order('id')
      .range(from, to)),
    ]);
    const billed = new Set(bills.map(b => b.unit_id));
    const missing = units.filter(u => !billed.has(u.id));
    if (!focused) return { count: missing.length, items: [] };
    const items = missing.slice(offset, offset + PAGE_SIZE).map(u => ({
      id: u.id,
      primary: `Flat ${u.flat_number}`,
      secondary: `No bill for ${now.toLocaleString('en-US', { month: 'short' })} ${now.getFullYear()}`,
    }));
    return { count: missing.length, items };
  } catch {
    return { count: null, items: [] };
  }
}

async function loadContractRenewals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  societyId: string,
  now: Date,
  focused: boolean,
  offset: number,
): Promise<CategoryResult> {
  const asOf = now.toISOString().slice(0, 10);
  try {
    const contracts = await fetchAll((from, to) => supabase
      .from('vendor_contracts')
      .select('id, title, end_date, renewal_notice_days, status')
      .eq('society_id', societyId)
      .eq('status', 'ACTIVE')
      .is('archived_at', null)
      .order('end_date')
      .order('id')
      .range(from, to));
    const due = classifyRenewals(
      contracts.filter(row => isContractRenewalDue(row.end_date, row.renewal_notice_days, asOf)),
      row => row.end_date,
      asOf,
      Number.POSITIVE_INFINITY,
    );
    if (!focused) return { count: due.length, items: [] };
    const items = due.slice(offset, offset + PAGE_SIZE).map(row => ({
      id: row.id,
      primary: row.title,
      secondary: `${row.due_status === 'OVERDUE' ? 'Ended' : 'Ends'} ${formatDate(row.due_date)}`,
    }));
    return { count: due.length, items };
  } catch {
    return { count: null, items: [] };
  }
}

async function loadStaleBackups(
  supabase: Awaited<ReturnType<typeof createClient>>,
  societyId: string,
  now: Date,
): Promise<CategoryResult> {
  const res = await supabase
    .from('society_usage_current')
    .select('last_snapshot_at, last_snapshot_result, measured_at')
    .eq('society_id', societyId)
    .maybeSingle();
  if (res.error) return { count: null, items: [] };
  const row = res.data;
  const stale = isBackupStale(row?.last_snapshot_at ?? null, row?.last_snapshot_result ?? null, now);
  if (!stale) return { count: 0, items: [] };
  const detail = !row
    ? 'No backup has been recorded yet.'
    : row.last_snapshot_result === 'FAILED'
      ? 'The most recent scheduled backup failed.'
      : `Last successful backup ${row.last_snapshot_at ? formatDate(String(row.last_snapshot_at).slice(0, 10)) : 'unknown'}.`;
  return { count: 1, items: [{ id: 'backup-status', primary: 'Backup needs attention', secondary: detail }] };
}

async function loadCategory(
  def: AttentionCategoryDef,
  supabase: Awaited<ReturnType<typeof createClient>>,
  societyId: string,
  societySlug: string | null,
  now: Date,
  focused: boolean,
  offset: number,
): Promise<CategoryResult> {
  try {
    switch (def.key) {
      case 'pending_claims': return await loadPendingClaims(supabase, societyId, focused, offset);
      case 'gateway_reconciliation': return await loadGatewayReconciliation(supabase, societyId, focused, offset);
      case 'unmatched_bank_lines': return await loadUnmatchedBankLines(supabase, societyId, focused, offset, societySlug);
      case 'missing_current_bills': return await loadMissingCurrentBills(supabase, societyId, now, focused, offset);
      case 'contract_renewals': return await loadContractRenewals(supabase, societyId, now, focused, offset);
      case 'stale_backups': return await loadStaleBackups(supabase, societyId, now);
    }
  } catch {
    return { count: null, items: [] };
  }
}

// Summary counts for the Payments default view — every visible category counted
// (no item pages fetched), so the "N items need attention" strip never polls and
export async function loadAttentionCounts(
  societyId: string,
  societySlug: string | null,
  role: AppRole,
): Promise<{ total: number; hasFailure: boolean; visibleCount: number }> {
  const supabase = await createClient();
  const now = new Date();
  const visible = visibleAttentionCategories(role);
  if (visible.length === 0) return { total: 0, hasFailure: false, visibleCount: 0 };
  const results = await Promise.all(
    visible.map(def => loadCategory(def, supabase, societyId, societySlug, now, false, 0)),
  );
  let total = 0;
  let hasFailure = false;
  for (const res of results) {
    if (res.count === null) hasFailure = true;
    else total += res.count;
  }
  return { total, hasFailure, visibleCount: visible.length };
}

interface AttentionViewProps {
  societyId: string;
  societySlug: string | null;
  role: AppRole;
  params: { cat?: string; page?: string };
}

// Server component. Read-only worklist that composes every existing exception
// source into one place; it links to correction workflows and writes nothing.
export default async function AttentionView({ societyId, societySlug, role, params }: AttentionViewProps) {
  const supabase = await createClient();
  const now = new Date();
  const visible = visibleAttentionCategories(role);

  if (visible.length === 0) {
    return (
      <div className="space-y-3">
        <TypeChips active="attention" societySlug={societySlug} />
        <p className="text-[13px] text-[var(--sf-label2)]">No attention items are available for your role.</p>
      </div>
    );
  }

  const requestedFocus = params.cat as AttentionCategoryKey | undefined;
  const focusKey: AttentionCategoryKey =
    requestedFocus && isAttentionCategoryVisible(role, requestedFocus) ? requestedFocus : visible[0].key;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;


  const results = await Promise.all(
    visible.map(def => loadCategory(def, supabase, societyId, societySlug, now, def.key === focusKey, offset)),
  );
  const byKey = new Map(visible.map((def, i) => [def.key, results[i]] as const));
  const focused = attentionCategory(focusKey);
  const focusedResult = byKey.get(focusKey) ?? { count: null, items: [] };
  const focusedCount = focusedResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(focusedCount / PAGE_SIZE));

  const buildHref = (key: AttentionCategoryKey, p?: number) => {
    const qs = new URLSearchParams({ cat: key });
    if (p && p > 1) qs.set('page', String(p));
    return societyPath(societySlug, `/payments/attention?${qs.toString()}`);
  };

  return (
    <div className="space-y-3">
      <TypeChips active="attention" societySlug={societySlug} />

      {/* Category selector — each shows its live count or a failure flag */}
      <div className="flex flex-wrap gap-1.5">
        {visible.map(def => {
          const res = byKey.get(def.key);
          const isFocus = def.key === focusKey;
          const label = res?.count === null ? '!' : String(res?.count ?? 0);
          return (
            <Link
              key={def.key}
              href={buildHref(def.key)}
              className={[
                'h-8 px-3 flex items-center gap-1.5 rounded-[var(--radius-md)] text-[var(--text-sm)] font-medium transition-all no-underline',
                isFocus
                  ? 'bg-[var(--sf-label)] text-white'
                  : 'border border-[var(--sf-border)] text-[var(--sf-label2)] hover:bg-[rgba(144,174,173,0.12)]',
              ].join(' ')}
            >
              {def.label}
              <span
                className={[
                  'inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold',
                  res?.count === null ? 'bg-sf-red/20 text-sf-red' : isFocus ? 'bg-white/20 text-white' : 'bg-[rgba(144,174,173,0.2)]',
                ].join(' ')}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Focused category detail */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--sf-border)] px-4 py-3">
          <div>
            <p className="text-[14px] font-semibold text-[var(--sf-label)]">{focused.label}</p>
            <p className="text-[12px] text-[var(--sf-label2)]">{focused.description}</p>
          </div>
          <Link
            href={societyPath(societySlug, focused.href)}
            className="shrink-0 rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--sf-label)] no-underline hover:bg-[rgba(144,174,173,0.12)]"
          >
            Open {focused.label.toLowerCase().includes('backup') ? 'settings' : 'workflow'} →
          </Link>
        </div>

        {focusedResult.count === null ? (
          <div role="alert" className="px-4 py-4 text-[13px] text-sf-red">
            This list could not be loaded. Do not assume it is empty — try again shortly.
          </div>
        ) : focusedResult.items.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-[var(--sf-label2)]">Nothing needs attention here.</p>
        ) : (
          <ul className="divide-y divide-[var(--sf-border)]">
            {focusedResult.items.map(item => {
              const inner = (
                <>
                  <span className="text-[13px] font-medium text-[var(--sf-label)]">{item.primary}</span>
                  {item.secondary ? <span className="block text-[12px] text-[var(--sf-label2)]">{item.secondary}</span> : null}
                </>
              );
              const href = item.href ?? societyPath(societySlug, focused.href);
              return (
                <li key={item.id}>
                  <Link href={href} className="block px-4 py-3 no-underline hover:bg-[rgba(144,174,173,0.08)]">
                    {inner}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--sf-border)] px-4 py-2.5 text-[12px]">
            <span className="text-[var(--sf-label2)]">Page {page} of {totalPages}</span>
            <div className="flex gap-1.5">
              {page > 1 && (
                <Link href={buildHref(focusKey, page - 1)} className="rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-1 text-[var(--sf-label)] no-underline hover:bg-[rgba(144,174,173,0.12)]">
                  ← Prev
                </Link>
              )}
              {page < totalPages && (
                <Link href={buildHref(focusKey, page + 1)} className="rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-1 text-[var(--sf-label)] no-underline hover:bg-[rgba(144,174,173,0.12)]">
                  Next →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
