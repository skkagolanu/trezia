import Link from 'next/link';
import FilterBar from '@/components/ui/FilterBar';
import PeriodChips from '@/components/ui/PeriodChips';
import { createClient } from '@/lib/supabase/server';
import { resolvePeriod, type PeriodKey } from '@/lib/utils/period';
import { labelDisplay } from '@/lib/utils/levy-label';
import { societyPath } from '@/lib/society-path';
import TypeChips from './TypeChips';
import PaymentsTableBody from './PaymentsTableBody';
import UnifiedTableBody, { type UnifiedRow } from './UnifiedTableBody';

const PAGE_SIZE = 50;

interface UnifiedSearchParams {
  period?: string; flat?: string; from?: string; to?: string; page?: string;
  mode?: string; resident?: string; amountMin?: string; amountMax?: string;
}

// Resolve the list-section period. `fy` is deliberately NOT accepted here: it
// belongs to the Reports section and may linger in the URL — "This FY" in a
// payments list must always mean the current FY.
function listPeriod(params: UnifiedSearchParams) {
  return resolvePeriod({ period: params.period, from: params.from, to: params.to }, { defaultKey: 'month' });
}

// The default /payments view. `typeFilter: 'all'` merges maintenance payments
// with levy (AMC/CMC) payments into one chronological list — the single place
// that shows every kind of money coming in for a flat. `typeFilter:
// 'maintenance'` narrows to monthly maintenance only.
export default async function UnifiedView({ params, typeFilter, societyId, societySlug }: { params: UnifiedSearchParams; typeFilter: 'all' | 'maintenance'; societyId: string; societySlug: string | null }) {
  const supabase = await createClient();
  const page     = Math.max(1, Number(params.page ?? 1));
  const offset   = (page - 1) * PAGE_SIZE;

  const resolved = listPeriod(params);
  const effectiveFrom = resolved.from;
  const effectiveTo   = resolved.to;

  // Maintenance payments
  let mq = supabase
    .from('payments')
    .select('id, receipt_number, amount_paid, payment_mode, payment_date, months_detail, recorded_by, receipt_pdf_url, is_voided, units!payments_unit_same_society(flat_number, residents!residents_unit_same_society(full_name, is_primary, is_active, phone, email)), residents!payments_resident_same_society(full_name, phone, email)', { count: 'exact' })
    .eq('society_id', societyId)
    .order('payment_date', { ascending: false })
    .order('created_at',   { ascending: false });

  let flatUnitIds: string[] | null = null;
  if (params.flat) {
    const { data: mu } = await supabase.from('units').select('id').eq('society_id', societyId).ilike('flat_number', params.flat);
    flatUnitIds = (mu ?? []).map(u => u.id);
    mq = flatUnitIds.length > 0 ? mq.in('unit_id', flatUnitIds) : mq.in('unit_id', ['00000000-0000-0000-0000-000000000000']);
  }

  let residentUnitIds: string[] | null = null;
  if (params.resident) {
    const { data: mr } = await supabase.from('residents').select('unit_id').eq('society_id', societyId).ilike('full_name', `%${params.resident}%`);
    residentUnitIds = [...new Set((mr ?? []).map(r => r.unit_id))];
    mq = residentUnitIds.length > 0 ? mq.in('unit_id', residentUnitIds) : mq.in('unit_id', ['00000000-0000-0000-0000-000000000000']);
  }

  const amountMin = params.amountMin ? Number(params.amountMin) : undefined;
  const amountMax = params.amountMax ? Number(params.amountMax) : undefined;

  if (params.mode)     mq = mq.eq('payment_mode', params.mode as never);
  if (effectiveFrom)   mq = mq.gte('payment_date', effectiveFrom);
  if (effectiveTo)     mq = mq.lte('payment_date', effectiveTo);
  if (amountMin != null) mq = mq.gte('amount_paid', amountMin);
  if (amountMax != null) mq = mq.lte('amount_paid', amountMax);

  if (typeFilter === 'maintenance') {
    mq = mq.range(offset, offset + PAGE_SIZE - 1);
  } else {
    // unified (type=all): over-fetch the top (offset + PAGE_SIZE) from each source so the
    // merged-by-date page is complete and correctly paginated
    mq = mq.range(0, offset + PAGE_SIZE - 1);
  }

  const { data: rawPayments, count: payCount } = await mq;

  // Levy payments (for type=all only)
  let levyRows: UnifiedRow[] = [];
  let levyCount = 0;
  if (typeFilter === 'all') {
    let lq = supabase
      .from('amc_collections')
      .select('id, levy_label, amount_paid, payment_mode, payment_date, recorded_by, is_voided, units!amc_unit_same_society(flat_number, residents!residents_unit_same_society(full_name, is_primary, is_active, phone, email)), residents!amc_resident_same_society(full_name, phone, email)', { count: 'exact' })
      .eq('society_id', societyId)
      .eq('is_voided', false)
      .order('payment_date', { ascending: false });
    if (effectiveFrom) lq = lq.gte('payment_date', effectiveFrom);
    if (effectiveTo)   lq = lq.lte('payment_date', effectiveTo);
    if (flatUnitIds)   lq = flatUnitIds.length > 0 ? lq.in('unit_id', flatUnitIds) : lq.in('unit_id', ['00000000-0000-0000-0000-000000000000']);
    if (residentUnitIds) lq = residentUnitIds.length > 0 ? lq.in('unit_id', residentUnitIds) : lq.in('unit_id', ['00000000-0000-0000-0000-000000000000']);
    if (amountMin != null) lq = lq.gte('amount_paid', amountMin);
    if (amountMax != null) lq = lq.lte('amount_paid', amountMax);
    lq = lq.range(0, offset + PAGE_SIZE - 1);
    const { data: rawLevy, count: lc } = await lq;
    levyCount = lc ?? 0;
    levyRows = (rawLevy ?? []).map(l => {
      const unit = l.units as unknown as { flat_number: string; residents: Array<{ full_name: string; is_primary: boolean; is_active: boolean; phone: string | null; email: string | null }> } | null;
      const residents = unit?.residents ?? [];
      const direct = l.residents as unknown as { full_name: string; phone: string | null; email: string | null } | null;
      const primary = direct ?? residents.find(r => r.is_primary && r.is_active) ?? residents.find(r => r.is_active) ?? residents[0];
      return {
        id: l.id, kind: 'levy' as const,
        flat: unit?.flat_number ?? '—',
        resident: primary?.full_name ?? '—',
        phone: primary?.phone ?? null,
        email: primary?.email ?? null,
        amount: Number(l.amount_paid),
        mode: l.payment_mode,
        date: l.payment_date ?? '',
        period: labelDisplay(l.levy_label),
        recordedBy: (l as unknown as { recorded_by?: string | null }).recorded_by ?? null,
        isVoided: l.is_voided ?? false,
        receiptNumber: null,
        pdfUrl: null,
      };
    });
  }

  const maintenanceRows: UnifiedRow[] = (rawPayments ?? []).map(p => {
    const unit = p.units as unknown as { flat_number: string; residents: Array<{ full_name: string; is_primary: boolean; is_active: boolean; phone: string | null; email: string | null }> } | null;
    const direct = p.residents as unknown as { full_name: string; phone: string | null; email: string | null } | null;
    const unitResidents = unit?.residents ?? [];
    const fallback = unitResidents.find(resident => resident.is_primary && resident.is_active)
      ?? unitResidents.find(resident => resident.is_active)
      ?? unitResidents[0];
    const resident = direct ?? fallback;
    return {
      id: p.id, kind: 'payment' as const,
      flat: unit?.flat_number ?? '—',
      resident: resident?.full_name ?? '—',
      phone: resident?.phone ?? null,
      email: resident?.email ?? null,
      amount: Number(p.amount_paid),
      mode: p.payment_mode,
      date: p.payment_date ?? '',
      period: (p as unknown as { months_detail?: string }).months_detail ?? '—',
      recordedBy: (p as unknown as { recorded_by?: string | null }).recorded_by ?? null,
      isVoided: p.is_voided,
      receiptNumber: p.receipt_number ?? null,
      pdfUrl: (p as unknown as { receipt_pdf_url?: string | null }).receipt_pdf_url ?? null,
    };
  });

  // Merge + sort for type=all
  const allRows = typeFilter === 'all'
    ? [...maintenanceRows, ...levyRows].sort((a, b) => b.date.localeCompare(a.date)).slice(offset, offset + PAGE_SIZE)
    : maintenanceRows;

  const unifiedCount = (payCount ?? 0) + levyCount;
  const totalPages = typeFilter === 'maintenance'
    ? Math.ceil((payCount ?? 0) / PAGE_SIZE)
    : typeFilter === 'all'
      ? Math.ceil(unifiedCount / PAGE_SIZE)
      : 1;
  const modeOptions = ['UPI', 'MANUAL_COLLECTION', 'BANK_TRANSFER', 'CASH', 'CHEQUE', 'NEFT', 'IMPS', 'ADVANCE', 'OTHER'];

  const buildLink = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string> = { type: typeFilter };
    if (params.flat)      merged.flat      = params.flat;
    if (params.mode)      merged.mode      = params.mode;
    if (params.resident)  merged.resident  = params.resident;
    if (params.amountMin) merged.amountMin = params.amountMin;
    if (params.amountMax) merged.amountMax = params.amountMax;
    if (params.period)    merged.period    = params.period;
    if (params.from)      merged.from      = params.from;
    if (params.to)        merged.to        = params.to;
    merged.page = String(page);
    Object.assign(merged, overrides);
    const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v !== undefined && v !== '') as [string, string][]);
    return societyPath(societySlug, `/payments?${qs}`);
  };

  return (
    <div className="space-y-3">
      <TypeChips active={typeFilter} societySlug={societySlug} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodChips
          basePath={societyPath(societySlug, '/payments')}
          keep={{ type: typeFilter, flat: params.flat, mode: params.mode, resident: params.resident, amountMin: params.amountMin, amountMax: params.amountMax }}
          active={resolved.key as PeriodKey}
          from={params.from}
          to={params.to}
        />
      </div>

      {resolved.key === 'custom' && (
        <FilterBar
          keep={['type', 'period', 'flat', 'mode', 'resident', 'amountMin', 'amountMax']}
          fields={[
            { type: 'date' as const, name: 'from' },
            { type: 'date' as const, name: 'to' },
          ]}
        />
      )}

      <FilterBar
        keep={['type', 'period', 'from', 'to']}
        fields={[
          { type: 'text' as const, name: 'flat', placeholder: 'Flat e.g. 101', widthClass: 'w-24' },
          { type: 'text' as const, name: 'resident', placeholder: 'Resident name', widthClass: 'w-36' },
          { type: 'number' as const, name: 'amountMin', placeholder: 'Min ₹', widthClass: 'w-20' },
          { type: 'number' as const, name: 'amountMax', placeholder: 'Max ₹', widthClass: 'w-20' },
          ...(typeFilter === 'maintenance'
            ? [{ type: 'select' as const, name: 'mode', placeholder: 'All modes', options: modeOptions.map(m => ({ value: m, label: m.replace(/_/g, ' ') })) }]
            : []),
        ]}
      />

      {/* Unified table */}
      {typeFilter === 'maintenance' ? (
        // Maintenance: uses PaymentsTableBody (has optimistic void + receipt actions)
        <>
          <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <PaymentsTableBody payments={(rawPayments ?? []).map(p => ({
                  id: p.id, receipt_number: p.receipt_number ?? null,
                  receipt_pdf_url: (p as unknown as { receipt_pdf_url: string | null }).receipt_pdf_url,
                  amount_paid: Number(p.amount_paid), payment_mode: p.payment_mode,
                  payment_date: p.payment_date, months_detail: (p as unknown as { months_detail?: string }).months_detail ?? null,
                  recorded_by: (p as unknown as { recorded_by?: string | null }).recorded_by ?? null,
                  is_voided: p.is_voided,
                  unit: (p.units as unknown as { flat_number: string } | null),
                  resident: (() => {
                    const unit = p.units as unknown as { residents?: Array<{ full_name: string; is_primary: boolean; is_active: boolean; phone: string | null }> } | null;
                    const direct = p.residents as unknown as { full_name: string; phone: string | null } | null;
                    return direct ?? unit?.residents?.find(item => item.is_primary && item.is_active) ?? unit?.residents?.find(item => item.is_active) ?? unit?.residents?.[0] ?? null;
                  })(),
                }))} />
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-[var(--sf-divider)] px-4 py-2.5">
                <p className="text-[var(--text-xs)] text-[var(--sf-label2)]">Page {page} of {totalPages} — {payCount} total</p>
                <div className="flex gap-2">
                  {page > 1 && <Link href={buildLink({ page: String(page - 1) })} className="h-7 flex items-center px-3 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-xs)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04] no-underline">Previous</Link>}
                  {page < totalPages && <Link href={buildLink({ page: String(page + 1) })} className="h-7 flex items-center px-3 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-xs)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04] no-underline">Next</Link>}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        // All: unified table (maintenance + levy rows)
        <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <UnifiedTableBody rows={allRows} />
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[var(--sf-divider)] px-4 py-2.5">
              <p className="text-[var(--text-xs)] text-[var(--sf-label2)]">Page {page} of {totalPages} — {unifiedCount} total</p>
              <div className="flex gap-2">
                {page > 1 && <Link href={buildLink({ page: String(page - 1) })} className="h-7 flex items-center px-3 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-xs)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04] no-underline">Previous</Link>}
                {page < totalPages && <Link href={buildLink({ page: String(page + 1) })} className="h-7 flex items-center px-3 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-xs)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04] no-underline">Next</Link>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
