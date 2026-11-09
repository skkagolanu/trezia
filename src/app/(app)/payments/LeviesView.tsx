import Link from 'next/link';
import EmptyState from '@/components/ui/EmptyState';
import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { societyPath } from '@/lib/society-path';
import { aggregateLevyCollections, levyStatusFor } from '@/lib/utils/levies';
import { canonicalLevyLabel, compareLevyLabels, labelDisplay } from '@/lib/utils/levy-label';
import type { AmcCollection } from '@/types/database';
import type { LevyAssessmentLike } from '@/lib/utils/levies';
import TypeChips from './TypeChips';
import LevyTableBody from './LevyTableBody';

interface LeviesSearchParams {
  levy?: string;
  amcStatus?: string;
}

type LevyUnitRow = {
  id: string;
  flat_number: string;
  residents: Array<{ id: string; full_name: string; is_primary: boolean; is_active: boolean }> | null;
};

type LevyAssessmentRow = LevyAssessmentLike & {
  id: string;
  levy_label: string;
  created_at: string;
};

// AMC is tracked separately from recurring monthly maintenance. Historical
// labels remain readable so consolidating CMC never hides an old receipt.
export default async function LeviesView({ params, societyId, societySlug }: { params: LeviesSearchParams; societyId: string; societySlug: string | null }) {
  const supabase = await createClient();

  // Test units are excluded here: the levy tracker is a financial view
  // (paid/pending counts + totals). Test levy records remain visible and
  // voidable from the unified list (/payments).
  const [unitsRaw, allCollections, assessmentsRaw] = await Promise.all([
    // The hand-maintained Database relationship metadata cannot infer this
    // named residents join, so narrow it after the PostgREST boundary.
    fetchAll<unknown>((f, t) => supabase.from('units')
      .select('id, flat_number, residents!residents_unit_same_society(id, full_name, is_primary, is_active)')
      .eq('society_id', societyId)
      .eq('is_active', true)
      .eq('is_test_unit', false)
      .order('flat_number', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t)),
    fetchAll<AmcCollection>((f, t) => supabase.from('amc_collections')
      .select('id, society_id, unit_id, resident_id, levy_label, amount_paid, payment_date, payment_mode, notes, pdf_url, recorded_by, is_voided, void_reason, voided_at, created_at, units!amc_unit_same_society!inner(is_test_unit)')
      .eq('society_id', societyId)
      .eq('is_voided', false)
      .eq('units.is_test_unit', false)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t)),
    fetchAll<LevyAssessmentRow>((f, t) => supabase.from('levy_assessments')
      .select('id, unit_id, levy_label, amount, amount_settled, status, is_voided, created_at')
      .eq('society_id', societyId)
      .eq('is_voided', false)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t)),
  ]).catch(() => {
    throw new Error('The AMC ledger could not be loaded. Retry before relying on collection status.');
  });

  const assessmentLabels = assessmentsRaw.map(row => canonicalLevyLabel(row.levy_label));
  const collectionLabels = allCollections.map(row => canonicalLevyLabel(row.levy_label));
  const distinctLabels = [...new Set([...assessmentLabels, ...collectionLabels])].sort(compareLevyLabels);

  const requestedLabel = typeof params.levy === 'string' ? canonicalLevyLabel(params.levy) : null;
  const activeLabel = requestedLabel && distinctLabels.includes(requestedLabel)
    ? requestedLabel : (distinctLabels[0] ?? 'AMC-2026');

  const assessmentsByUnit = new Map<string, LevyAssessmentLike>();
  const rawLabels = new Set<string>();
  for (const assessment of assessmentsRaw) {
    if (canonicalLevyLabel(assessment.levy_label) !== activeLabel) continue;
    rawLabels.add(assessment.levy_label);
    const current = assessmentsByUnit.get(assessment.unit_id);
    const amount = Math.max(Number(assessment.amount), current?.amount ?? 0);
    const amountSettled = Math.min(amount, Number(assessment.amount_settled) + Number(current?.amount_settled ?? 0));
    assessmentsByUnit.set(assessment.unit_id, {
      unit_id: assessment.unit_id,
      amount,
      amount_settled: amountSettled,
      status: amountSettled >= amount ? 'PAID' : 'PENDING',
      is_voided: false,
    });
  }
  const recordLabel = [...rawLabels].find(label => /^AMC-/i.test(label)) ?? [...rawLabels][0] ?? activeLabel;

  type UnitRow = { id: string; flat_number: string; primaryResident: string | null; primaryResidentId: string | null };
  const units: UnitRow[] = (unitsRaw as LevyUnitRow[]).map(u => {
    const res = u.residents as unknown as Array<{ id: string; full_name: string; is_primary: boolean; is_active: boolean }>;
    const primary = res?.find(r => r.is_primary && r.is_active);
    return { id: u.id, flat_number: u.flat_number, primaryResident: primary?.full_name ?? null, primaryResidentId: primary?.id ?? null };
  }).filter(unit => assessmentsByUnit.has(unit.id) || allCollections.some(collection =>
    collection.unit_id === unit.id && canonicalLevyLabel(collection.levy_label) === activeLabel));

  const paidCollections = allCollections.filter(c => canonicalLevyLabel(c.levy_label) === activeLabel);
  const defaultAmount = Math.max(0, ...[...assessmentsByUnit.values()].map(assessment => Number(assessment.amount)));
  const summaries = aggregateLevyCollections(paidCollections, defaultAmount, assessmentsByUnit);
  const statusFor       = (unitId: string) => summaries.get(unitId)?.status ?? levyStatusFor(0, defaultAmount);
  const paidCount       = units.filter(unit => statusFor(unit.id) === 'paid').length;
  const partialCount    = units.filter(unit => statusFor(unit.id) === 'partial').length;
  const pendingCount    = units.length - paidCount - partialCount;

  const amcStatusFilter = params.amcStatus === 'paid' || params.amcStatus === 'partial' || params.amcStatus === 'pending' ? params.amcStatus : 'all';
  const displayUnits = amcStatusFilter === 'all'
    ? units
    : units.filter(unit => statusFor(unit.id) === amcStatusFilter);
  const amcStatusHref = (status: 'all' | 'paid' | 'partial' | 'pending') =>
    societyPath(societySlug, `/payments/levies?${new URLSearchParams({ levy: activeLabel, ...(status !== 'all' ? { amcStatus: status } : {}) })}`);

  return (
    <div className="space-y-3">
      <TypeChips active="amc" societySlug={societySlug} />

      <h2 className="text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">Annual Maintenance Contract (AMC)</h2>

      {/* Levy tabs */}
      <div className="flex flex-wrap gap-1.5">
        {distinctLabels.map(label => (
          <Link
            key={label}
            href={societyPath(societySlug, `/payments/levies?levy=${encodeURIComponent(label)}`)}
            className={`h-8 px-3 flex items-center rounded-[var(--radius-md)] text-[var(--text-sm)] font-medium transition-colors no-underline ${
              label === activeLabel
                ? 'bg-[var(--sf-blue)] text-white'
                : 'border border-[var(--sf-border)] text-[var(--sf-label2)] hover:bg-black/[0.04]'
            }`}
          >
            {labelDisplay(label)}
          </Link>
        ))}
      </div>

      <div className="flex gap-1">
          {(['all', 'paid', 'partial', 'pending'] as const).map(s => (
            <Link
              key={s}
              href={amcStatusHref(s)}
              className={`h-7 px-2.5 flex items-center rounded-[var(--radius-md)] text-[var(--text-xs)] font-medium capitalize transition-colors no-underline ${
                amcStatusFilter === s
                  ? 'bg-[var(--sf-label)] text-white'
                  : 'border border-[var(--sf-border)] text-[var(--sf-label2)] hover:bg-black/[0.04]'
              }`}
            >
              {s === 'all'
                ? `All ${paidCount + partialCount + pendingCount}`
                : s === 'paid'
                  ? `Paid ${paidCount}`
                  : s === 'partial'
                    ? `Partial ${partialCount}`
                    : `Pending ${pendingCount}`}
            </Link>
          ))}
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] overflow-hidden">
        {displayUnits.length === 0 ? (
          units.length === 0 ? (
            <EmptyState
              icon={
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="8" height="8" rx="1"/>
                  <rect x="13" y="3" width="8" height="8" rx="1"/>
                  <rect x="3" y="13" width="8" height="8" rx="1"/>
                  <rect x="13" y="13" width="8" height="8" rx="1"/>
                </svg>
              }
              heading="No flats have this AMC"
              body="Raise the AMC for this year before tracking payments."
              action={{ label: 'Go to Residents →', href: societyPath(societySlug, '/residents') }}
            />
          ) : (
            <EmptyState
              icon={
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M9 12h6M9 16h4"/>
                </svg>
              }
              heading={`No ${amcStatusFilter} flats for this AMC`}
              body="Try a different status filter to see the rest of the flats."
              action={{ label: 'View all flats →', href: amcStatusHref('all') }}
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <LevyTableBody units={displayUnits} paidCollections={paidCollections} activeLabel={recordLabel} defaultAmount={defaultAmount} assessmentsByUnit={Object.fromEntries(assessmentsByUnit)} />
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
