import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/fetch-all';
import KPICard from './KPICard';
import { formatINR } from '@/lib/utils/currency';
import { formatDate, todayISO } from '@/lib/utils/date';
import DuesMatrix from '@/components/ui/DuesMatrix';
import FilterBar from '@/components/ui/FilterBar';
import PaymentCoverageMatrix from '@/components/ui/PaymentCoverageMatrix';
import PeriodChips from '@/components/ui/PeriodChips';
import DefaulterSheet from './DefaulterSheet';
import type { DuesSummary } from '@/types/database';
import { findPaymentMonthOverlaps, parseMonthsDetail } from '@/lib/utils/months';
import { fyLabel, fyOptions, fyStartYearOf, monthRange, resolvePeriod } from '@/lib/utils/period';
import { isDueAsOn, sumByCategory } from '@/lib/utils/balance';
import { CATEGORY_LABELS } from '@/lib/constants/categories';
import { CollectionsBarChart, CollVsExpChart, ExpenseDonutChart, LevyBarChart } from '@/components/charts/dynamic';
import { SLICE_COLORS } from '@/components/charts/shared';
import { missingBilledUnitIds } from '@/lib/utils/billing';
import { societyPath } from '@/lib/society-path';
import { canonicalLevyLabel, labelDisplay } from '@/lib/utils/levy-label';
import { outstandingAmount } from '@/lib/utils/billing';

const FY_MONTHS = (fyStartYear: number) => [
  { year: fyStartYear,     month: 4,  label: 'Apr' },
  { year: fyStartYear,     month: 5,  label: 'May' },
  { year: fyStartYear,     month: 6,  label: 'Jun' },
  { year: fyStartYear,     month: 7,  label: 'Jul' },
  { year: fyStartYear,     month: 8,  label: 'Aug' },
  { year: fyStartYear,     month: 9,  label: 'Sep' },
  { year: fyStartYear,     month: 10, label: 'Oct' },
  { year: fyStartYear,     month: 11, label: 'Nov' },
  { year: fyStartYear,     month: 12, label: 'Dec' },
  { year: fyStartYear + 1, month: 1,  label: 'Jan' },
  { year: fyStartYear + 1, month: 2,  label: 'Feb' },
  { year: fyStartYear + 1, month: 3,  label: 'Mar' },
];

type PaymentRow = { payment_date: string | null; amount_paid: number };
type ExpenseRow = { category: string; amount: number; expense_date: string };
type DueBillRow = { unit_id: string; bill_period_year: number; bill_period_month: number; payable_amount: number; amount_settled: number; status: string; due_date: string };
type LevyAssessmentReportRow = {
  unit_id: string;
  levy_label: string;
  amount: number;
  amount_settled: number;
  status: 'PENDING' | 'PAID';
};
type ReportUnitRow = {
  id: string;
  flat_number: string;
  residents: Array<{ full_name: string; is_primary: boolean; is_active: boolean }> | null;
};
type CurrentMonthBillRow = { unit_id: string };
type OverlapUnitRow = { id: string; flat_number: string; is_test_unit: boolean };
type OverlapPaymentRow = {
  id: string;
  unit_id: string;
  months_detail: string | null;
  receipt_number: string | null;
  payment_date: string;
  amount_paid: number;
};

const monthLabel = (y: number, m: number) =>
  new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' });

export default async function ReportsContent({
  fy,
  q,
  show,
  period,
  from,
  to,
}: {
  fy?: string;
  q?: string;
  show?: string;
  period?: string;
  from?: string;
  to?: string;
}) {
  // Auth runs here (inside the Suspense boundary), not in the parent page — so a
  // period/FY change re-shows the skeleton instantly instead of blocking on the
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_read')) redirect('/access-denied');

  const supabase = await createClient();
  const now = new Date();

  // The period selector drives KPIs, charts, and the expense breakdown.
  // The dues/coverage matrix is inherently monthly-billed, so it always shows
  // one FY: the selected FY (or the FY a selected quarter belongs to), or the
  // FY containing the period end otherwise.
  const resolved = resolvePeriod({ period, from, to, fy, q }, { defaultKey: 'fy', now });
  const showFilter = show === 'outstanding' ? 'outstanding' : 'all';
  const asOn = resolved.to ?? todayISO();

  const matrixFyStart =
    resolved.key === 'fy' || resolved.key === 'quarter'
      ? (fy && !Number.isNaN(parseInt(fy, 10)) ? parseInt(fy, 10) : fyStartYearOf(now))
      : fyStartYearOf(new Date(asOn + 'T12:00:00'));
  const matrixFyLabel = fyLabel(matrixFyStart);
  const fyMonths = FY_MONTHS(matrixFyStart);

  const [
    paymentsInRange,
    expensesInRange,
    allBillsRaw,
    allUnitsRaw,
    levyAssessmentsRaw,
    paymentsForCoverage,
    dueBillsAllTime,
    currentMonthBillsRaw,
    duesSummaryRaw,
    { data: configRaw },
    overlapPaymentsRaw,
    overlapUnitsRaw,
  ] = await Promise.all([
    // Collected KPI + monthly chart. Direct table query (not v_monthly_collections)
    // so custom/partial-month ranges are exact. Test units excluded (migration 023 rule).
    fetchAll<PaymentRow>((f, t) => {
      let q = supabase
        .from('payments')
        .select('payment_date, amount_paid, units!payments_unit_same_society!inner(is_test_unit)')
        .eq('society_id', auth.societyId)
        .eq('is_voided', false)
        .eq('units.is_test_unit', false);
      if (resolved.from) q = q.gte('payment_date', resolved.from);
      if (resolved.to)   q = q.lte('payment_date', resolved.to);
      return q
        .order('payment_date', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t);
    }),
    fetchAll<ExpenseRow>((f, t) => {
      let q = supabase
        .from('expenditures')
        .select('category, amount, expense_date')
        .eq('society_id', auth.societyId)
        .eq('is_voided', false);
      if (resolved.from) q = q.gte('expense_date', resolved.from);
      if (resolved.to)   q = q.lte('expense_date', resolved.to);
      return q
        .order('expense_date', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t);
    }),
    fetchAll<DueBillRow>((f, t) => supabase
      .from('bills')
      .select('unit_id, bill_period_year, bill_period_month, payable_amount, amount_settled, status, due_date, units!bills_unit_same_society!inner(is_test_unit)')
      .eq('society_id', auth.societyId)
      .eq('is_voided', false)
      .eq('units.is_test_unit', false)
      .or(`and(bill_period_year.eq.${matrixFyStart},bill_period_month.gte.4),and(bill_period_year.eq.${matrixFyStart + 1},bill_period_month.lte.3)`)
      .order('bill_period_year', { ascending: true })
      .order('bill_period_month', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t)),
    // The hand-maintained Database relationship metadata cannot infer this
    // named residents join, so narrow it after the PostgREST boundary.
    fetchAll<unknown>((f, t) => supabase
      .from('units')
      .select('id, flat_number, residents!residents_unit_same_society(full_name, is_primary, is_active)')
      .eq('society_id', auth.societyId)
      .eq('is_active', true)
      .eq('is_test_unit', false)
      .order('flat_number', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t)),
    fetchAll<LevyAssessmentReportRow>((f, t) => supabase
      .from('levy_assessments')
      .select('unit_id, levy_label, amount, amount_settled, status')
      .eq('society_id', auth.societyId)
      .eq('is_voided', false)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t)),
    // Payment coverage — only for pre-2025 matrix FYs where no bills exist.
    // Wide window (6 months either side) captures advance and late payers.
    matrixFyStart < 2025
      ? fetchAll<{ unit_id: string; months_detail: string | null }>((f, t) =>
          supabase
            .from('payments')
            .select('unit_id, months_detail, units!payments_unit_same_society!inner(is_test_unit)')
            .eq('society_id', auth.societyId)
            .eq('is_voided', false)
            .eq('units.is_test_unit', false)
            .not('months_detail', 'is', null)
            .not('unit_id', 'is', null)
            .gte('payment_date', `${matrixFyStart - 1}-10-01`)
            .lte('payment_date', `${matrixFyStart + 1}-09-30`)
            .order('payment_date', { ascending: true })
            .order('id', { ascending: true })
            .range(f, t),
        )
      : Promise.resolve([] as Array<{ unit_id: string; months_detail: string | null }>),
    // Outstanding-as-on for non-FY periods (FY periods reuse the matrix bills).
    resolved.key !== 'fy'
      ? fetchAll<DueBillRow>((f, t) =>
          supabase
            .from('bills')
            .select('unit_id, bill_period_year, bill_period_month, payable_amount, amount_settled, status, due_date, units!bills_unit_same_society!inner(is_test_unit)')
            .eq('society_id', auth.societyId)
            .eq('is_voided', false)
            .eq('units.is_test_unit', false)
            .in('status', ['ISSUED', 'OVERDUE'])
            .order('bill_period_year', { ascending: true })
            .order('id', { ascending: true })
            .range(f, t),
        )
      : Promise.resolve([] as DueBillRow[]),
    fetchAll<CurrentMonthBillRow>((f, t) => supabase
      .from('bills')
      .select('unit_id')
      .eq('society_id', auth.societyId)
      .eq('bill_period_year', now.getFullYear())
      .eq('bill_period_month', now.getMonth() + 1)
      .eq('is_voided', false)
      .order('unit_id', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t)),
    // All-time defaulters: OVERDUE always + ISSUED after their stored due date.
    fetchAll<DuesSummary>((f, t) => supabase.from('v_dues_summary').select('*')
      .eq('society_id', auth.societyId)
      .order('flat_number', { ascending: true })
      .range(f, t)),
    // Collect-request links: society name + UPI VPA for the WhatsApp/upi:// deep links.
    supabase.from('society_config').select('name, upi_id').eq('society_id', auth.societyId).single(),
    fetchAll<OverlapPaymentRow>((f, t) => supabase
      .from('payments')
      .select('id, unit_id, months_detail, receipt_number, payment_date, amount_paid')
      .eq('society_id', auth.societyId)
      .eq('is_voided', false)
      .not('months_detail', 'is', null)
      .order('payment_date', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t)),
    fetchAll<OverlapUnitRow>((f, t) => supabase.from('units').select('id, flat_number, is_test_unit')
      .eq('society_id', auth.societyId)
      .order('flat_number', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t)),
  ]);

  const overlapUnitMap = new Map(overlapUnitsRaw
    .filter(unit => !unit.is_test_unit)
    .map(unit => [unit.id, unit.flat_number]));
  const paymentOverlaps = findPaymentMonthOverlaps(overlapPaymentsRaw
    .filter(payment => overlapUnitMap.has(payment.unit_id))
    .map(payment => ({
    id: payment.id,
    unit_id: payment.unit_id,
    months_detail: payment.months_detail,
    receipt_number: payment.receipt_number,
    payment_date: payment.payment_date,
    amount_paid: Number(payment.amount_paid),
    flat_number: overlapUnitMap.get(payment.unit_id) ?? payment.unit_id,
  })));

  // KPI: collected + payment count over the selected period
  const collected = paymentsInRange.reduce((s, r) => s + Number(r.amount_paid), 0);
  const paymentCount = paymentsInRange.length;

  // KPI + donut: expenses over the selected period
  const categoryBreakdown = sumByCategory(
    expensesInRange.map(r => ({ date: r.expense_date, amount: Number(r.amount), category: r.category })),
  );
  const expenseTotal = categoryBreakdown.reduce((s, r) => s + r.total, 0);
  const netSurplus = collected - expenseTotal;

  // Monthly aggregation for the two time charts
  const collectedByMonth = new Map<string, { total: number; count: number }>();
  for (const r of paymentsInRange) {
    if (!r.payment_date) continue;
    const mk = r.payment_date.substring(0, 7);
    const cur = collectedByMonth.get(mk) ?? { total: 0, count: 0 };
    cur.total += Number(r.amount_paid);
    cur.count++;
    collectedByMonth.set(mk, cur);
  }
  const expenseByMonth = new Map<string, number>();
  for (const r of expensesInRange) {
    const mk = r.expense_date.substring(0, 7);
    expenseByMonth.set(mk, (expenseByMonth.get(mk) ?? 0) + Number(r.amount));
  }
  const monthKeys = [...new Set([...collectedByMonth.keys(), ...expenseByMonth.keys()])].sort();

  const collectionsChartData = monthKeys
    .filter(mk => collectedByMonth.has(mk))
    .map(mk => {
      const [y, m] = mk.split('-').map(Number);
      const c = collectedByMonth.get(mk)!;
      const { from: mFrom, to: mTo } = monthRange(y, m);
      return {
        month: monthLabel(y, m),
        collected: c.total,
        payment_count: c.count,
        href: `/payments?${new URLSearchParams({ type: 'maintenance', period: 'custom', from: mFrom, to: mTo })}`,
      };
    });

  const collVsExpData = monthKeys
    .map(mk => {
      const [y, m] = mk.split('-').map(Number);
      return {
        month: monthLabel(y, m),
        collected: collectedByMonth.get(mk)?.total ?? 0,
        expenses: expenseByMonth.get(mk) ?? 0,
      };
    })
    .filter(d => d.collected > 0 || d.expenses > 0);

  // Dues grid (always one FY)
  const fyBills = allBillsRaw;
  const billMap = new Map<string, Map<string, { status: string; amount: number; outstanding: number; due_date: string }>>();
  for (const b of fyBills) {
    if (!billMap.has(b.unit_id)) billMap.set(b.unit_id, new Map());
    billMap.get(b.unit_id)!.set(`${b.bill_period_year}-${b.bill_period_month}`, {
      status: b.status,
      amount: Number(b.payable_amount),
      outstanding: outstandingAmount(b),
      due_date: b.due_date,
    });
  }

  const allUnits = (allUnitsRaw as ReportUnitRow[]).map(u => {
    const residents = (Array.isArray(u.residents) ? u.residents : u.residents ? [u.residents] : []) as Array<{ full_name: string; is_primary: boolean; is_active: boolean }>;
    const primary = residents.find(r => r.is_primary && r.is_active) ?? residents.find(r => r.is_active);
    return { id: u.id, flat_number: u.flat_number, resident_name: primary?.full_name ?? '—' };
  });

  const unitDueMap = new Map<string, { total: number; monthsOwed: string[] }>();
  for (const unit of allUnits) {
    const months = billMap.get(unit.id);
    if (!months) continue;
    let total = 0; const monthsOwed: string[] = [];
    for (const [mk, { status, outstanding, due_date }] of months) {
      const [y, m] = mk.split('-').map(Number);
      if (isDueAsOn({ status, due_date }, asOn)) {
        total += outstanding;
        monthsOwed.push(`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${String(y).slice(2)}`);
      }
    }
    if (total > 0) unitDueMap.set(unit.id, { total, monthsOwed });
  }

  const paidFullyCount = allUnits.filter(u => {
    const m = billMap.get(u.id);
    if (!m || m.size === 0) return false;
    const active = Array.from(m.values()).filter(b => b.status === 'ISSUED' || b.status === 'OVERDUE' || b.status === 'PAID');
    return active.length > 0 && active.every(b => b.status === 'PAID');
  }).length;
  const fyOutstandingCount = unitDueMap.size;
  const fyTotalDue = Array.from(unitDueMap.values()).reduce((s, v) => s + v.total, 0);

  // Outstanding KPI: FY periods use the matrix's FY dues (matches the grid);
  // other periods use current-month receivables as on the period end.
  let outstandingTotal = fyTotalDue;
  let outstandingCount = fyOutstandingCount;
  if (resolved.key !== 'fy') {
    const due = dueBillsAllTime
      .map(b => ({ unitId: b.unit_id, status: b.status, due_date: b.due_date, amount: outstandingAmount(b) }))
      .filter(b => isDueAsOn(b, asOn));
    outstandingTotal = due.reduce((s, b) => s + b.amount, 0);
    outstandingCount = new Set(due.map(b => b.unitId)).size;
  }

  const billedMonthKeys = new Set(fyBills.map(b => `${b.bill_period_year}-${b.bill_period_month}`));
  const missingCurrentMonthUnitIds = missingBilledUnitIds(
    allUnits.map(unit => unit.id),
    currentMonthBillsRaw.map(bill => bill.unit_id),
  );
  const activeFyMonths  = fyMonths.filter(m => billedMonthKeys.has(`${m.year}-${m.month}`));
  const hasBills        = activeFyMonths.length > 0;

  // Coverage mode: pre-2025 FYs with no bills — derive coverage from payments.
  const isCoverageMode = !hasBills && matrixFyStart < 2025;
  const coverageMap = new Map<string, Set<string>>();
  if (isCoverageMode) {
    for (const p of paymentsForCoverage) {
      if (!p.unit_id || !p.months_detail) continue;
      for (const { year, month } of parseMonthsDetail(p.months_detail)) {
        const inFy = (year === matrixFyStart && month >= 4) || (year === matrixFyStart + 1 && month <= 3);
        if (!inFy) continue;
        if (!coverageMap.has(p.unit_id)) coverageMap.set(p.unit_id, new Set());
        coverageMap.get(p.unit_id)!.add(`${year}-${month}`);
      }
    }
  }
  const coveredFullyCount   = isCoverageMode
    ? allUnits.filter(u => (coverageMap.get(u.id)?.size ?? 0) >= 12).length : 0;
  const coveredPartialCount = isCoverageMode
    ? allUnits.filter(u => { const s = coverageMap.get(u.id)?.size ?? 0; return s > 0 && s < 12; }).length : 0;

  // Defaulter list is ALL-TIME (every unpaid bill across all years), independent
  // of the selected FY/period — sourced from v_dues_summary (carries phone too).
  const duesSummary = duesSummaryRaw;
  const societyConfig = configRaw as { name: string; upi_id: string | null } | null;

  const displayUnits = showFilter === 'outstanding' ? allUnits.filter(u => unitDueMap.has(u.id)) : allUnits;

  // Lifetime levy view backed by obligations actually raised per flat. A
  // configuration alone is not a debt, and current-unit-count × current
  // default is not a historical expected total. Historical CMC year labels
  // share one AMC presentation bucket without rewriting any receipt.
  const levySummaryMap = new Map<string, {
    label: string;
    expected: number;
    collected: number;
    paidFull: number;
    unitIds: Set<string>;
  }>();
  for (const assessment of levyAssessmentsRaw) {
    const key = canonicalLevyLabel(assessment.levy_label);
    const row = levySummaryMap.get(key) ?? {
      label: labelDisplay(key), expected: 0, collected: 0, paidFull: 0, unitIds: new Set<string>(),
    };
    const amount = Number(assessment.amount);
    row.expected += amount;
    row.collected += Math.min(amount, Number(assessment.amount_settled));
    row.paidFull += assessment.status === 'PAID' ? 1 : 0;
    row.unitIds.add(assessment.unit_id);
    levySummaryMap.set(key, row);
  }
  const levySummary = [...levySummaryMap.values()].map(row => ({
    ...row,
    totalUnits: row.unitIds.size,
    pct: row.expected > 0 ? (row.collected / row.expected) * 100 : 0,
  }));
  const amcTotalCollected = levySummary.reduce((sum, row) => sum + row.collected, 0);

  // Drill-through target mirrors the Reports section's own selected range exactly,
  // so the expense list a click lands on always matches what the donut showed.
  const expenseDrillParams: Record<string, string> = resolved.from && resolved.to
    ? { period: 'custom', from: resolved.from, to: resolved.to }
    : { period: 'all' };
  const expenseChartData = categoryBreakdown.map(r => ({
    label: CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS] ?? r.category,
    total: r.total,
    href: `/expenses?${new URLSearchParams({ ...expenseDrillParams, category: r.category })}`,
  }));

  const levyChartData = levySummary.map(l => ({
    label: l.label, collected: l.collected, expected: l.expected,
    paidFull: l.paidFull, totalUnits: l.totalUnits, pct: l.pct,
  }));

  const activeFyValue = resolved.key === 'fy' || resolved.key === 'quarter' ? String(matrixFyStart) : undefined;

  return (
    <div className="space-y-3">
        {/* Period selector + print */}
        <div className="flex flex-wrap items-center gap-2">
          <PeriodChips
            basePath={societyPath(auth.societySlug, '/reports')}
            keep={{ show: showFilter === 'outstanding' ? 'outstanding' : undefined }}
            active={resolved.key}
            activeFy={activeFyValue}
            activeQuarter={q}
            fyOptions={fyOptions(now)}
            showLastMonth
            showQuarters
            from={from}
            to={to}
          />
        </div>

        {resolved.key === 'custom' && (
          <FilterBar
            keep={['period', 'show']}
            fields={[
              { type: 'date' as const, name: 'from' },
              { type: 'date' as const, name: 'to' },
            ]}
          />
        )}

        {missingCurrentMonthUnitIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--sf-orange)_30%,transparent)] bg-[color-mix(in_srgb,var(--sf-orange)_7%,var(--sf-surface))] px-4 py-3">
            <div>
              <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-orange)]">
                {monthLabel(now.getFullYear(), now.getMonth() + 1)} bills are missing for {missingCurrentMonthUnitIds.length} flat{missingCurrentMonthUnitIds.length !== 1 ? 's' : ''}
              </p>
              <p className="mt-0.5 text-[var(--text-xs)] text-[var(--sf-label2)]">Missing bills cannot appear in dues totals or notices.</p>
            </div>
            <Link data-society-write href={societyPath(auth.societySlug, '/bills/generate')} className="rounded-[var(--radius-md)] bg-[var(--sf-blue)] px-3 py-2 text-[var(--text-xs)] font-semibold text-white no-underline hover:opacity-90">
              Review and generate
            </Link>
          </div>
        )}

        {paymentOverlaps.length > 0 && (
          <details className="rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--sf-orange)_30%,transparent)] bg-[color-mix(in_srgb,var(--sf-orange)_5%,var(--sf-surface))]" open>
            <summary className="cursor-pointer list-none px-4 py-3 text-[var(--text-sm)] font-semibold text-[var(--sf-orange)]">
              Payment overlaps · {paymentOverlaps.length} flat-month{paymentOverlaps.length !== 1 ? 's' : ''} need review
            </summary>
            <div className="overflow-x-auto border-t border-[color-mix(in_srgb,var(--sf-orange)_20%,transparent)]">
              <table className="w-full text-[var(--text-sm)]">
                <thead>
                  <tr className="text-left text-[var(--text-xs)] text-[var(--sf-label2)]">
                    <th className="px-4 py-2 font-semibold">Flat</th>
                    <th className="px-4 py-2 font-semibold">Month</th>
                    <th className="px-4 py-2 font-semibold">Active payments</th>
                    <th className="px-4 py-2 font-semibold text-right">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--sf-divider)]">
                  {paymentOverlaps.map(overlap => (
                    <tr key={`${overlap.unitId}-${overlap.year}-${overlap.month}`}>
                      <td className="px-4 py-3 font-semibold text-[var(--sf-label)]">{overlap.flatNumber}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-[var(--sf-label)]">{overlap.label}</td>
                      <td className="px-4 py-3 text-[var(--sf-label2)]">
                        {overlap.payments.map(payment => (
                          <div key={payment.id}>
                            {payment.receipt_number ?? 'No receipt'} · {formatDate(payment.payment_date)} · {formatINR(payment.amount_paid)}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={societyPath(auth.societySlug, `/payments?${new URLSearchParams({ type: 'maintenance', period: 'all', flat: overlap.flatNumber })}`)}
                          className="text-[var(--text-xs)] font-medium text-[var(--sf-blue)] hover:underline"
                        >
                          View payments
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3 lg:items-stretch">
          <div className="space-y-3 min-w-0">

        {/* KPI strip — all four respect the selected period */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KPICard label="Collected"   rawValue={collected}    sub={`${paymentCount} payment${paymentCount !== 1 ? 's' : ''} · ${resolved.label}`} color="green" />
          <KPICard label="Expenses"    rawValue={expenseTotal} sub={`${categoryBreakdown.length} categor${categoryBreakdown.length !== 1 ? 'ies' : 'y'} · ${resolved.label}`} color="red" />
          <KPICard label="Collected − Expenses" rawValue={Math.abs(netSurplus)} prefix={netSurplus >= 0 ? '+' : '−'} sub={collected > 0 ? `${Math.round((netSurplus / collected) * 100)}% of collections` : resolved.label} color={netSurplus >= 0 ? 'green' : 'red'} tip="Maintenance collected minus all expenses in the selected period. This is NOT the bank balance — see the Balance Sheet page for the full cash position." />
          <KPICard
            label="Outstanding"
            rawValue={outstandingTotal}
            sub={`${outstandingCount} of ${allUnits.length} flats${resolved.key !== 'fy' ? ` · as on ${asOn}` : ''}`}
            color="red"
            tip={
              resolved.key !== 'fy'
                ? 'Total owed across all billed periods as on the end of the selected range (overdue bills always count; issued bills count once their month has arrived).'
                : isCoverageMode
                  ? 'Bill tracking was not in place for this period — no maintenance bills were generated, so outstanding shows ₹0. Use the payment coverage grid to see which flats have records.'
                  : 'Total amount owed by flats with unpaid maintenance bills in this financial year.'
            }
          />
        </div>

        {/* Monthly Collections | Collections vs Expenses */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3">
            <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label2)] mb-2">Monthly Collections — {resolved.label}</p>
            {collectionsChartData.length > 0
              ? <CollectionsBarChart data={collectionsChartData} />
              : <p className="py-4 text-center text-[var(--text-sm)] text-[var(--sf-label3)]">No collection data for {resolved.label}.</p>}
          </div>
          <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3">
            <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label2)] mb-2">Collections vs Expenses — {resolved.label}</p>
            {collVsExpData.length > 0
              ? <CollVsExpChart data={collVsExpData} />
              : <p className="py-4 text-center text-[var(--text-sm)] text-[var(--sf-label3)]">No data for {resolved.label}.</p>}
          </div>
        </div>

        {/* Expenses by Category | AMC / Levy Summary */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3">
            <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label2)] mb-2">Expenses by Category — {resolved.label}</p>
            {categoryBreakdown.length > 0 ? (
              <>
                <ExpenseDonutChart data={expenseChartData} total={expenseTotal} />
                <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-0.5">
                  {expenseChartData.slice(0, 6).map((row, i) => (
                    <div key={row.label} className="flex items-center gap-1 min-w-0">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                      <span className="truncate text-[var(--text-xs)] text-[var(--sf-label2)]">{row.label}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-[var(--sf-divider)] pt-1.5 mt-2 flex justify-between text-[var(--text-xs)] font-semibold text-[var(--sf-label)]">
                  <span>Total</span>
                  <span className="tabular">{formatINR(expenseTotal)}</span>
                </div>
              </>
            ) : (
              <p className="py-4 text-center text-[var(--text-sm)] text-[var(--sf-label3)]">No expense data for {resolved.label}.</p>
            )}
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label2)]">AMC Summary</p>
              <Link href={societyPath(auth.societySlug, '/payments/levies')} className="text-[var(--text-xs)] text-[var(--sf-blue)] hover:underline no-underline">
                View all →
              </Link>
            </div>
            {levySummary.length > 0 ? (
              <>
                <div className="flex-1 min-h-0" style={{ minHeight: Math.max(120, levyChartData.length * 28 + 16) }}>
                  <LevyBarChart data={levyChartData} />
                </div>
                <div className="border-t border-[var(--sf-divider)] pt-1.5 mt-2 flex justify-between text-[var(--text-xs)] font-semibold">
                  <span className="text-[var(--sf-label)]">Total settled</span>
                  <span className="tabular text-sf-green">{formatINR(amcTotalCollected)}</span>
                </div>
              </>
            ) : (
              <p className="py-4 text-center text-[var(--text-sm)] text-[var(--sf-label3)]">No AMC data.</p>
            )}
          </div>
        </div>

          </div>

          {/* RIGHT: Maintenance Dues (always one FY — the matrix is monthly-billed) */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3 flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <div>
            <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label2)]">
              {isCoverageMode ? `Payment Coverage — ${matrixFyLabel}` : `Maintenance Dues — ${matrixFyLabel}`}
            </p>
            <p className="text-[var(--text-xs)] text-[var(--sf-label3)] mt-0.5">
              {isCoverageMode
                ? `${coveredFullyCount} fully covered · ${coveredPartialCount} partial · ${allUnits.length - coveredFullyCount - coveredPartialCount} not on record`
                : `${fyOutstandingCount} with dues · ${paidFullyCount} fully paid`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isCoverageMode ? <CoverageLegend /> : <Legend />}
            {!isCoverageMode && (
              <Link
                href={societyPath(auth.societySlug, `/reports?${new URLSearchParams({
                  ...(period ? { period } : {}),
                  ...(fy ? { fy } : {}),
                  ...(q ? { q } : {}),
                  ...(from ? { from } : {}),
                  ...(to ? { to } : {}),
                  show: showFilter === 'outstanding' ? 'all' : 'outstanding',
                })}`)}
                className={`h-7 px-3 flex items-center rounded-[var(--radius-md)] text-[var(--text-xs)] font-medium transition-colors no-underline whitespace-nowrap ${
                  showFilter === 'outstanding'
                    ? 'bg-[rgba(192,57,43,0.10)] text-[var(--sf-red)]'
                    : 'border border-[var(--sf-border)] text-[var(--sf-label2)] hover:bg-black/[0.04]'
                }`}
              >
                {showFilter === 'outstanding' ? 'All flats' : 'Outstanding only'}
              </Link>
            )}
          </div>
        </div>
        {hasBills ? (
          <div className="grow basis-0 min-h-0 overflow-auto">
            <DuesMatrix units={displayUnits} billMap={billMap} activeFyMonths={activeFyMonths} asOn={asOn} />
          </div>
        ) : isCoverageMode ? (
          <div className="grow basis-0 min-h-0 overflow-auto">
            <PaymentCoverageMatrix units={allUnits} coverageMap={coverageMap} fyMonths={fyMonths} />
          </div>
        ) : (
          <div className="py-6 text-center">
            <p className="text-[var(--text-sm)] text-[var(--sf-label2)]">No bills generated for {matrixFyLabel} yet.</p>
          </div>
        )}
          </div>
        </div>

        {/* All-time defaulters (every unpaid month across all years) + per-flat dues notices */}
        <DefaulterSheet dues={duesSummary} societyName={societyConfig?.name ?? 'the society'} upiVpa={societyConfig?.upi_id ?? null} />
    </div>
  );
}


function Legend() {
  return (
    <div className="flex items-center gap-3 text-[var(--text-xs)] text-[var(--sf-label3)]">
      <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-sf-green" /> Paid</span>
      <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-sf-red" /> Overdue</span>
      <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-sf-purple" /> Issued</span>
      <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-black/[0.07]" /> Not billed</span>
    </div>
  );
}

function CoverageLegend() {
  return (
    <div className="flex items-center gap-3 text-[var(--text-xs)] text-[var(--sf-label3)]">
      <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-sf-green" /> Paid</span>
      <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-black/[0.07]" /> Not on record</span>
    </div>
  );
}
