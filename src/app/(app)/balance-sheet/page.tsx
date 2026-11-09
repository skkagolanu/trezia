import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { fetchAll } from '@/lib/supabase/fetch-all';
import FilterBar from '@/components/ui/FilterBar';
import PageHeader from '@/components/ui/PageHeader';
import PeriodChips from '@/components/ui/PeriodChips';
import Tooltip from '@/components/ui/Tooltip';
import { CATEGORY_LABELS, INCOME_CATEGORY_LABELS } from '@/lib/constants/categories';
import { formatINR } from '@/lib/utils/currency';
import { formatDate, todayISO } from '@/lib/utils/date';
import { fyLabel, fyOptions, fyStartYearOf, resolvePeriod, type PeriodKey } from '@/lib/utils/period';
import {
  computeStatement,
  isDueAsOn,
  sumByCategory,
  sumInRange,
  undatedTotal,
  type DatedAmount,
} from '@/lib/utils/balance';
import { computeIncomeExpenditure, computeBalanceSheetEquity } from '@/lib/utils/audit-pack';
import { getComplianceReminder } from '@/lib/utils/compliance-dates';
import type { DuesSummary, ExpenseCategory, IncomeCategory } from '@/types/database';
import PrintBalanceSheetButton, { type PrintLine } from './PrintBalanceSheetButton';
import AuditPackButton, { type AuditPackData } from './AuditPackButton';
import { societyPath } from '@/lib/society-path';
import { canonicalLevyLabel, labelDisplay } from '@/lib/utils/levy-label';
import { outstandingAmount } from '@/lib/utils/billing';

export const metadata = { title: 'Balance Sheet · Trezia' };

interface SearchParams {
  period?: string;
  fy?: string;
  q?: string;
  from?: string;
  to?: string;
}

type MaintRow = { payment_date: string | null; amount_paid: number };
type LevyRow = { payment_date: string | null; amount_paid: number };
type IncomeRow = { income_date: string | null; amount: number; category: string };
type ExpenseRow = { expense_date: string | null; amount: number; category: string };
type SnapshotRow = { snapshot_date: string; bank_balance: number | null; cash_in_hand: number | null };
type FundRow = { entry_type: string; amount: number; entry_date: string };
type DueBillRow = { unit_id: string; payable_amount: number; amount_settled: number; status: string; due_date: string };
type FyBillRow = { payable_amount: number };
type AuditLevyRow = { levy_label: string; amount: number; amount_settled: number; status: string; unit_id: string };

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const bsParams = await searchParams;
  return (
    <Suspense key={JSON.stringify(bsParams)} fallback={<ListSkeleton />}>
      <BalanceSheetContent searchParams={searchParams} />
    </Suspense>
  );
}

async function BalanceSheetContent({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_read')) redirect('/access-denied');

  const params = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const resolved = resolvePeriod(params, { defaultKey: 'fy', now });
  const asOn = resolved.to ?? todayISO();

  // Full-table fetches (paginated past the 1,000-row PostgREST cap) because the
  // opening-balance anchor needs transactions OUTSIDE the selected range too.
  // Test units (T00) are excluded from every financial figure — same rule as
  // the SQL views (migration 023).
  const [maintRows, levyRows, incomeRows, expenseRows, snapshotRows, dueBillRows, fundRows, configRes] = await Promise.all([
    fetchAll<MaintRow>((f, t) =>
      supabase
        .from('payments')
        .select('payment_date, amount_paid, units!payments_unit_same_society!inner(is_test_unit)')
        .eq('society_id', auth.societyId)
        .eq('is_voided', false)
        .eq('units.is_test_unit', false)
        .order('payment_date', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t),
    ),
    fetchAll<LevyRow>((f, t) =>
      supabase
        .from('amc_collections')
        .select('payment_date, amount_paid, units!amc_unit_same_society!inner(is_test_unit)')
        .eq('society_id', auth.societyId)
        .eq('is_voided', false)
        .eq('units.is_test_unit', false)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t),
    ),
    fetchAll<IncomeRow>((f, t) =>
      supabase
        .from('other_income')
        .select('income_date, amount, category')
        .eq('society_id', auth.societyId)
        .eq('is_voided', false)
        .order('income_date', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t),
    ),
    fetchAll<ExpenseRow>((f, t) =>
      supabase
        .from('expenditures')
        .select('expense_date, amount, category')
        .eq('society_id', auth.societyId)
        .eq('is_voided', false)
        .order('expense_date', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t),
    ),
    fetchAll<SnapshotRow>((f, t) =>
      supabase
        .from('balance_snapshots')
        .select('snapshot_date, bank_balance, cash_in_hand')
        .eq('society_id', auth.societyId)
        .order('snapshot_date', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t),
    ),
    fetchAll<DueBillRow>((f, t) =>
      supabase
        .from('bills')
        .select('unit_id, payable_amount, amount_settled, status, due_date, units!bills_unit_same_society!inner(is_test_unit)')
        .eq('society_id', auth.societyId)
        .eq('is_voided', false)
        .eq('units.is_test_unit', false)
        .in('status', ['ISSUED', 'OVERDUE'])
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t),
    ),
    fetchAll<FundRow>((f, t) =>
      supabase
        .from('fund_ledger_entries')
        .select('entry_type, amount, entry_date')
        .eq('society_id', auth.societyId)
        .eq('fund_type', 'CORPUS')
        .eq('is_voided', false)
        .order('entry_date', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t),
    ),
    supabase.from('society_config').select('name').eq('society_id', auth.societyId).maybeSingle(),
  ]);

  const maint: DatedAmount[] = maintRows.map(r => ({ date: r.payment_date, amount: Number(r.amount_paid) }));
  const levies: DatedAmount[] = levyRows.map(r => ({ date: r.payment_date, amount: Number(r.amount_paid) }));
  const income = incomeRows.map(r => ({ date: r.income_date, amount: Number(r.amount), category: r.category }));
  const expenses = expenseRows.map(r => ({ date: r.expense_date, amount: Number(r.amount), category: r.category }));
  const snapshots = snapshotRows.map(s => ({
    date: s.snapshot_date,
    total: Number(s.bank_balance ?? 0) + Number(s.cash_in_hand ?? 0),
  }));

  const receipts: DatedAmount[] = [...maint, ...levies, ...income];
  const statement = computeStatement({ from: resolved.from, to: resolved.to, snapshots, receipts, payments: expenses });

  // Receipts breakdown
  const maintTotal = sumInRange(maint, resolved.from, resolved.to);
  const levyTotal = sumInRange(levies, resolved.from, resolved.to);
  const incomeByCat = sumByCategory(income, resolved.from, resolved.to);
  const undatedLevies = undatedTotal(levies);

  // Payments breakdown
  const expByCat = sumByCategory(expenses, resolved.from, resolved.to);

  // Position as on the period end
  const dueBills = dueBillRows
    .map(b => ({ unitId: b.unit_id, status: b.status, due_date: b.due_date, amount: outstandingAmount(b) }))
    .filter(b => isDueAsOn(b, asOn));
  const outstandingTotal = dueBills.reduce((s, b) => s + b.amount, 0);
  const outstandingFlats = new Set(dueBills.map(b => b.unitId)).size;

  // Corpus balances come from the fund ledger.
  const corpusEntries = fundRows.filter(r => r.entry_date <= asOn);
  const corpusIn = corpusEntries.filter(r => r.entry_type === 'CONTRIBUTION' || r.entry_type === 'INTEREST').reduce((s, r) => s + Number(r.amount), 0);
  const corpusOut = corpusEntries.filter(r => r.entry_type === 'OUTFLOW').reduce((s, r) => s + Number(r.amount), 0);
  const corpusNet = corpusIn - corpusOut;

  // The latest snapshot on or before asOn, in one pass. Sorting the whole list
  // (two array copies and an O(n log n) sort) only to read one element off the
  // end is work proportional to the society's entire snapshot history on every
  // page load.
  const latestSnapshot = snapshots.reduce<typeof snapshots[number] | null>(
    (latest, s) => (s.date <= asOn && (latest === null || s.date > latest.date) ? s : latest),
    null,
  );

  // configRes.data is null when the config row is missing or RLS-denied
  // (maybeSingle, not single) — degrade to a neutral label instead of 500ing.
  const societyName = (configRes.data as { name: string } | null)?.name ?? 'Your Society';
  const activeFy = resolved.key === 'fy' || resolved.key === 'quarter'
    ? (params.fy ?? String(fyStartYearOf(now)))
    : undefined;

  const signed = (n: number) => `${n < 0 ? '−' : '+'}${formatINR(Math.abs(n))}`;

  // Rows shared by the on-screen statement and the print sheet
  const receiptLines: PrintLine[] = [
    { label: 'Maintenance collections', value: formatINR(maintTotal) },
    { label: 'AMC', value: formatINR(levyTotal) },
    ...incomeByCat.map(r => ({
      label: `Other income — ${INCOME_CATEGORY_LABELS[r.category as IncomeCategory] ?? r.category}`,
      value: formatINR(r.total),
    })),
  ];
  const paymentLines: PrintLine[] = expByCat.map(r => ({
    label: CATEGORY_LABELS[r.category as ExpenseCategory] ?? r.category,
    value: formatINR(r.total),
  }));
  const positionLines: PrintLine[] = [
    {
      label: latestSnapshot ? `Cash & bank (recorded ${formatDate(latestSnapshot.date)})` : 'Cash & bank (no snapshot on record)',
      value: latestSnapshot ? formatINR(latestSnapshot.total) : '—',
    },
    { label: `Receivables — maintenance dues (${outstandingFlats} flats)`, value: formatINR(outstandingTotal) },
    { label: 'Corpus fund (collected − paid out)', value: formatINR(corpusNet) },
  ];
  const notes: string[] = [
    'Cash-basis, single-entry statement. Voided records are excluded.',
    'Expense records for Sep 2024 – Apr 2025 are missing from the source Excel; balances across that window rely on recorded snapshots.',
  ];
  if (undatedLevies > 0) {
    notes.push(`${formatINR(undatedLevies)} of AMC collections have no recorded date and appear only in All Time totals.`);
  }

  const openingLine: PrintLine = {
    label: resolved.from ? `Opening balance (as on ${formatDate(resolved.from)})` : 'Opening balance',
    value: statement.opening.amount !== null ? formatINR(statement.opening.amount) : 'Not on record',
  };
  const closingLine: PrintLine = {
    label: `Closing balance (as on ${formatDate(asOn)})`,
    value: statement.closing !== null ? formatINR(statement.closing) : '—',
  };

  // Audit pack is FY-only — these extra queries only fire when a
  // specific FY is in view, not for month/quarter/all-time/custom periods.
  let auditPack: AuditPackData | null = null;
  if (resolved.key === 'fy' && activeFy) {
    const fyStart = Number(activeFy);
    const [fyBillsRaw, duesRaw, levyAssessmentsRaw] = await Promise.all([
      fetchAll<FyBillRow>((f, t) => supabase
        .from('bills')
        .select('payable_amount, units!bills_unit_same_society!inner(is_test_unit)')
        .eq('society_id', auth.societyId)
        .eq('is_voided', false)
        .eq('units.is_test_unit', false)
        .or(`and(bill_period_year.eq.${fyStart},bill_period_month.gte.4),and(bill_period_year.eq.${fyStart + 1},bill_period_month.lte.3)`)
        .order('bill_period_year', { ascending: true })
        .order('bill_period_month', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t)),
      fetchAll<DuesSummary>((f, t) => supabase
        .from('v_dues_summary')
        .select('*')
        .eq('society_id', auth.societyId)
        .order('flat_number', { ascending: true })
        .range(f, t)),
      fetchAll<AuditLevyRow>((f, t) => supabase
        .from('levy_assessments')
        .select('levy_label, amount, amount_settled, status, unit_id, units!levy_assessments_unit_same_society!inner(is_test_unit)')
        .eq('society_id', auth.societyId)
        .eq('is_voided', false)
        .eq('units.is_test_unit', false)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t)),
    ]);

    const maintenanceAccrued = fyBillsRaw.reduce((s, b) => s + Number(b.payable_amount), 0);
    const ie = computeIncomeExpenditure({
      maintenanceAccrued,
      otherIncomeTotal: incomeByCat.reduce((s, r) => s + r.total, 0),
      amcTotal: levyTotal,
      expenseTotal: statement.paymentsTotal,
    });
    const bs = computeBalanceSheetEquity({
      bankCash: latestSnapshot?.total ?? 0,
      receivables: outstandingTotal,
      corpusFund: corpusNet,
    });

    const defaulters = duesRaw
      .filter(d => (d.unpaid_months ?? 0) > 0)
      .sort((a, b) => (b.unpaid_months ?? 0) - (a.unpaid_months ?? 0))
      .map(d => ({ flat: d.flat_number, resident: d.primary_resident ?? '—', monthsDue: d.unpaid_months ?? 0, totalDue: formatINR(Number(d.total_due ?? 0)) }));

    const levyMap = new Map<string, { expected: number; settled: number; paid: number; units: Set<string> }>();
    for (const row of levyAssessmentsRaw) {
      const key = canonicalLevyLabel(row.levy_label);
      const aggregate = levyMap.get(key) ?? { expected: 0, settled: 0, paid: 0, units: new Set<string>() };
      const amount = Number(row.amount);
      aggregate.expected += amount;
      aggregate.settled += Math.min(amount, Number(row.amount_settled));
      aggregate.paid += row.status === 'PAID' ? 1 : 0;
      aggregate.units.add(row.unit_id);
      levyMap.set(key, aggregate);
    }
    const levies = [...levyMap].map(([label, aggregate]) => ({
      label: labelDisplay(label),
      expected: formatINR(aggregate.expected),
      collected: formatINR(aggregate.settled),
      paidFull: `${aggregate.paid} / ${aggregate.units.size}`,
    }));

    auditPack = {
      societyName,
      fyLabel: fyLabel(fyStart),
      rp: {
        opening: openingLine,
        receipts: receiptLines,
        receiptsTotal: formatINR(statement.receiptsTotal),
        payments: paymentLines,
        paymentsTotal: formatINR(statement.paymentsTotal),
        net: signed(statement.net),
        closing: closingLine,
      },
      ie: {
        income: [
          { label: 'Maintenance billed (accrual)', value: formatINR(maintenanceAccrued) },
          { label: 'AMC collected', value: formatINR(levyTotal) },
          ...incomeByCat.map(r => ({ label: `Other income — ${INCOME_CATEGORY_LABELS[r.category as IncomeCategory] ?? r.category}`, value: formatINR(r.total) })),
        ],
        incomeTotal: formatINR(ie.totalIncome),
        expenditure: paymentLines,
        expenditureTotal: formatINR(ie.totalExpenditure),
        surplusOrDeficit: signed(ie.surplusOrDeficit),
        note: 'Maintenance income is accrual-basis (billed, not collected, for the FY). Other income, AMC, and all expenditure are cash-basis — this app does not track accounts payable, so a full accrual statement is not supportable by the data on record.',
      },
      bs: {
        assets: [
          { label: latestSnapshot ? `Cash & bank (recorded ${formatDate(latestSnapshot.date)})` : 'Cash & bank (no snapshot on record)', value: formatINR(latestSnapshot?.total ?? 0) },
          { label: `Receivables — maintenance dues (${outstandingFlats} flats)`, value: formatINR(outstandingTotal) },
        ],
        totalAssets: formatINR(bs.totalAssets),
        equityAndLiabilities: [
          { label: 'Liabilities (none tracked)', value: formatINR(bs.totalLiabilities) },
          { label: 'Corpus fund (from fund ledger, as on period end)', value: formatINR(bs.corpusFund) },
          { label: 'Accumulated Reserve & Surplus (balancing figure)', value: formatINR(bs.reserveAndSurplus) },
        ],
        totalEquityAndLiabilities: formatINR(bs.totalEquityAndLiabilities),
        note: 'No accounts-payable ledger exists, so Liabilities is always ₹0. Corpus Fund is read from the fund ledger (contributions + interest − outflows, as on the period end). Reserve & Surplus remains a balancing figure, not an audited retained-earnings account.',
      },
      defaulters,
      levies,
    };
  }

  const compliance = getComplianceReminder(new Date());

  return (
    <div className="space-y-3">
      {compliance && (
        <div className={`rounded-[var(--radius-md)] border px-4 py-2.5 text-[var(--text-sm)] ${
          compliance.agmOverdue ? 'border-[var(--sf-red)]/30 bg-[var(--sf-red)]/[0.06] text-[var(--sf-red)]'
          : compliance.auditOverdue ? 'border-[var(--sf-orange)]/30 bg-[var(--sf-orange)]/[0.06] text-[var(--sf-orange)]'
          : 'border-[var(--sf-border)] bg-[var(--sf-bg)] text-[var(--sf-label2)]'
        }`}>
          {compliance.agmOverdue
            ? `AGM for ${compliance.fyLabel} is past the ${compliance.agmDueLabel} guideline — schedule it if it hasn't happened.`
            : compliance.auditOverdue
            ? `Audit for ${compliance.fyLabel} is past the ${compliance.auditDueLabel} guideline (Telangana society pattern) — AGM guideline is ${compliance.agmDueLabel}.`
            : `Reminder: ${compliance.fyLabel} books are typically audited by ${compliance.auditDueLabel}, with the AGM by ${compliance.agmDueLabel}. Use the Audit Pack button below once that FY is selected.`}
        </div>
      )}
      <PageHeader
        title="Balance Sheet"
        action={
          <div className="flex items-center gap-2">
            {auditPack && <AuditPackButton data={auditPack} />}
            <PrintBalanceSheetButton
              data={{
                societyName,
                periodLabel: resolved.label,
                opening: openingLine,
                receipts: receiptLines,
                receiptsTotal: formatINR(statement.receiptsTotal),
                payments: paymentLines,
                paymentsTotal: formatINR(statement.paymentsTotal),
                net: signed(statement.net),
                closing: closingLine,
                position: positionLines,
                notes,
              }}
            />
          </div>
        }
      />

      <PeriodChips
        basePath={societyPath(auth.societySlug, '/balance-sheet')}
        active={resolved.key as PeriodKey}
        activeFy={activeFy}
        activeQuarter={params.q}
        fyOptions={fyOptions(now)}
        showLastMonth
        showQuarters
        from={params.from}
        to={params.to}
      />

      {resolved.key === 'custom' && (
        <FilterBar
          keep={['period']}
          fields={[
            { type: 'date' as const, name: 'from' },
            { type: 'date' as const, name: 'to' },
          ]}
        />
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        {/* Receipts & Payments statement */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--sf-divider)] px-4 py-2.5">
            <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label2)]">
              Receipts &amp; Payments — {resolved.label}
            </p>
            <Tooltip text="Cash-basis statement: everything received minus everything spent in the selected period. Opening and closing balances are anchored to the treasurer's recorded balance snapshots." />
          </div>

          <dl className="divide-y divide-[var(--sf-divider)] text-[var(--text-sm)]">
            <StatementRow label={openingLine.label} value={openingLine.value} strong />

            <SectionHead label="Receipts" />
            {receiptLines.map(l => (
              <StatementRow key={l.label} label={l.label} value={l.value} indent />
            ))}
            <StatementRow label="Total receipts" value={formatINR(statement.receiptsTotal)} strong color="green" />

            <SectionHead label="Payments" />
            {paymentLines.length > 0 ? (
              paymentLines.map(l => <StatementRow key={l.label} label={l.label} value={l.value} indent />)
            ) : (
              <StatementRow label="No expenses recorded in this period" value="—" indent muted />
            )}
            <StatementRow label="Total payments" value={formatINR(statement.paymentsTotal)} strong color="red" />

            <StatementRow
              label="Net movement (receipts − payments)"
              value={signed(statement.net)}
              strong
              color={statement.net >= 0 ? 'green' : 'red'}
            />
            <StatementRow label={closingLine.label} value={closingLine.value} strong />
          </dl>
        </div>

        <div className="space-y-3">
          {/* As-on position */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--sf-divider)] px-4 py-2.5">
              <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label2)]">Position as on {formatDate(asOn)}</p>
              <Tooltip text="Receivables use the same deadline rule as the dues report: overdue bills always count; issued bills count only after their stored due date. Corpus fund is cumulative from the start of records." />
            </div>
            <dl className="divide-y divide-[var(--sf-divider)] text-[var(--text-sm)]">
              {positionLines.map(l => (
                <StatementRow key={l.label} label={l.label} value={l.value} />
              ))}
            </dl>
          </div>

          {/* Reconciliation */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label2)]">Reconciliation</p>
              <Tooltip text="Compares the treasurer's recorded balance snapshot against the balance computed from transactions. A difference usually means transactions are missing for the window (e.g. the Sep 2024 – Apr 2025 expense gap) — record a fresh snapshot to re-anchor." />
            </div>
            {statement.reconciliation ? (
              <>
                <ReconLine label={`Recorded snapshot (${formatDate(statement.reconciliation.snapshotDate)})`} value={formatINR(statement.reconciliation.recorded)} />
                <ReconLine label="Computed from transactions" value={formatINR(statement.reconciliation.computed)} />
                <ReconLine
                  label="Difference"
                  value={statement.reconciliation.difference === 0 ? 'Matches exactly' : signed(statement.reconciliation.difference)}
                  tone={statement.reconciliation.difference === 0 ? 'green' : 'red'}
                />
              </>
            ) : statement.opening.amount === null ? (
              <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">
                No balance snapshot exists before {resolved.from ? formatDate(resolved.from) : 'the start of records'}, so the opening balance is unknown.
                Add a snapshot for an earlier date under Settings → Balance Snapshots to anchor this statement.
              </p>
            ) : (
              <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">No balance snapshot recorded inside this period to reconcile against.</p>
            )}
          </div>

          {/* Notes */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4">
            <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label2)] mb-1.5">Notes</p>
            <ul className="list-disc pl-4 space-y-1 text-[var(--text-xs)] text-[var(--sf-label3)]">
              {notes.map(n => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1">
      <dt className="text-[var(--text-xs)] font-semibold uppercase tracking-wide text-[var(--sf-label2)]">{label}</dt>
    </div>
  );
}

function StatementRow({
  label,
  value,
  indent = false,
  strong = false,
  muted = false,
  color,
}: {
  label: string;
  value: string;
  indent?: boolean;
  strong?: boolean;
  muted?: boolean;
  color?: 'green' | 'red';
}) {
  const valueCls = color === 'green' ? 'text-sf-green' : color === 'red' ? 'text-sf-red' : 'text-[var(--sf-label)]';
  return (
    <div className={`flex items-baseline justify-between gap-3 px-4 py-2 ${indent ? 'pl-7' : ''}`}>
      <dt className={`${strong ? 'font-semibold text-[var(--sf-label)]' : muted ? 'text-[var(--sf-label3)]' : 'text-[var(--sf-label2)]'}`}>{label}</dt>
      <dd className={`tabular whitespace-nowrap ${strong ? `font-bold ${valueCls}` : muted ? 'text-[var(--sf-label3)]' : 'text-[var(--sf-label)]'}`}>{value}</dd>
    </div>
  );
}

function ReconLine({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  const cls = tone === 'green' ? 'text-sf-green font-semibold' : tone === 'red' ? 'text-sf-red font-semibold' : 'text-[var(--sf-label)]';
  return (
    <div className="flex items-baseline justify-between gap-3 text-[var(--text-sm)]">
      <span className="text-[var(--sf-label2)]">{label}</span>
      <span className={`tabular whitespace-nowrap ${cls}`}>{value}</span>
    </div>
  );
}
