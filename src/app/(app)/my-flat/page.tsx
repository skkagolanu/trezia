export const metadata = { title: 'My Flat · Trezia' };

import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { requireAuth } from '@/lib/supabase/require-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import Badge from '@/components/ui/Badge';
import { buildWhatsAppLink, buildUpiLink } from '@/lib/utils/collect-request';
import { buildDataAccessRequestMessage, buildConsentWithdrawalMessage } from '@/lib/utils/privacy-request';
import { isPayableBillStatus, outstandingAmount, summariseDues } from '@/lib/utils/billing';
import { outstandingLevy } from '@/lib/utils/levies';
import { gatewayEnabled } from '@/lib/payments/razorpay';
import { societyPath } from '@/lib/society-path';
import type { AmcCollection, Bill, LevyAssessment, Payment, ResidentPaymentClaim } from '@/types/database';
import PageHeader from '@/components/ui/PageHeader';
import PayButtons from './PayButtons';
import UpiQrPanel from './UpiQrPanel';
import UploadProof, { type PayableAccountLevySummary, type PayableBillSummary } from './UploadProof';
import { AccountPaymentAmountProvider } from './AccountPaymentAmount';
import RetractClaimButton from './RetractClaimButton';
import { labelDisplay } from '@/lib/utils/levy-label';

const HISTORY_PAGE_SIZE = 20;
const RECENT_BILL_MONTHS = 12;
const MONTH_LABELS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type SearchParams = Promise<{ history_page?: string | string[]; paid?: string | string[] }>;

type MaintenanceHistoryRow = Pick<
  Payment,
  'id' | 'amount_paid' | 'payment_date' | 'months_detail' | 'unapplied_amount' | 'auto_apply_credit'
>;

type ResidentBillRow = Pick<
  Bill,
  | 'id'
  | 'bill_period_year'
  | 'bill_period_month'
  | 'payable_amount'
  | 'amount_settled'
  | 'penalty_amount'
  | 'status'
  | 'due_date'
>;

type LevyHistoryRow = Pick<
  AmcCollection,
  'id' | 'unit_id' | 'levy_label' | 'amount_paid' | 'payment_date' | 'created_at' | 'is_voided'
>;

// Migration 067's per-unit obligation row. RLS already scopes this to the
// resident's own unit (levy_assessments_resident_select), so a plain select
// cannot surface another flat's levies even without the explicit filters below.
type LevyAssessmentRow = Pick<
  LevyAssessment,
  'id' | 'levy_label' | 'amount' | 'amount_settled' | 'status' | 'created_at'
>;

type ClaimRow = Pick<
  ResidentPaymentClaim,
  'id' | 'bill_ids' | 'amount' | 'status' | 'review_note' | 'submitted_at' | 'reviewed_at'
>;

type ResidentPaymentInfo = {
  society_name: string | null;
  treasurer_mobile: string | null;
  upi_id: string | null;
  upi_qr_object_key: string | null;
};

// 'retracted' (migration 066) is the resident withdrawing their own pending
// submission — neutral, not a rejection, so it gets the same gray as an
// inactive/no-op state rather than red.
const CLAIM_STATUS_BADGE = { pending: 'yellow', approved: 'green', rejected: 'red', retracted: 'gray' } as const;

export default async function MyFlatPage({ searchParams }: { searchParams: SearchParams }) {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (auth.role !== 'resident' || !auth.unitId) redirect(societyPath(auth.societySlug, '/payments'));
  const unitId = auth.unitId;

  const params = await searchParams;
  const rawHistoryPage = typeof params.history_page === 'string' ? Number.parseInt(params.history_page, 10) : 1;
  const requestedHistoryPage = Number.isFinite(rawHistoryPage) ? Math.max(1, rawHistoryPage) : 1;
  const supabase = await createClient();

  const [
    { data: unit,        error: unitError },
    { data: bills,       error: billsError },
    { data: payments,    error: paymentsError },
    { data: amcRaw,      error: amcError },
    { data: levyAssessmentsRaw, error: levyError },
  ] = await Promise.all([
    supabase
      .from('units')
      .select('flat_number, monthly_amount, residents!residents_unit_same_society(full_name, occupancy_type, is_primary, is_active)')
      .eq('id', unitId)
      .eq('society_id', auth.societyId)
      .single(),
    // EVERY non-voided bill, not the newest 12. This list is not just the table
    // below: it computes the dues headline, the UPI amount, the gateway bill
    // ids and the months offered in the proof form. Capping it at 12 quietly
    // capped the money — a flat with more than a year of arrears was shown a
    // total that excluded its oldest months, offered a payment that could never
    // clear them, and could not select them to upload proof against. Backfilled
    // arrears older than the twelve most recent months were invisible outright.
    // A unit has at most one bill per month, so this is months-of-history rows;
    // fetchAll paginates anyway, with the ordering tie-broken on id.
    fetchAll<ResidentBillRow>((from, to) => supabase
      .from('bills')
      .select('id, bill_period_year, bill_period_month, payable_amount, amount_settled, penalty_amount, status, due_date')
      .eq('unit_id', unitId)
      .eq('society_id', auth.societyId)
      .eq('is_voided', false)
      .order('bill_period_year', { ascending: false })
      .order('bill_period_month', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to))
      .then(data => ({ data, error: null }))
      .catch((error: Error) => ({ data: null, error })),
    fetchAll<MaintenanceHistoryRow>((from, to) => supabase
      .from('payments')
      .select('id, amount_paid, payment_date, months_detail, unapplied_amount, auto_apply_credit')
      .eq('unit_id', unitId)
      .eq('society_id', auth.societyId)
      .eq('is_voided', false)
      .order('payment_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to))
      .then(data => ({ data, error: null }))
      .catch((error: Error) => ({ data: null, error })),
    fetchAll<LevyHistoryRow>((from, to) => supabase
      .from('amc_collections')
      .select('id, unit_id, levy_label, amount_paid, payment_date, created_at, is_voided')
      .eq('unit_id', unitId)
      .eq('society_id', auth.societyId)
      .eq('is_voided', false)
      .order('payment_date', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(from, to))
      .then(data => ({ data, error: null }))
      .catch((error: Error) => ({ data: null, error })),
    supabase
      .from('levy_assessments')
      .select('id, levy_label, amount, amount_settled, status, created_at')
      .eq('unit_id', unitId)
      .eq('society_id', auth.societyId)
      .eq('is_voided', false)
      .order('created_at')
      .order('id')
      .returns<LevyAssessmentRow[]>(),
  ]);

  // society_config itself is admin/treasurer-only by policy, because it also holds
  // bank, tax and receipt-counter columns. This RPC (migration 065) returns just
  // the four fields a Resident is meant to see. Reading the table directly here
  // silently returned nothing for every Resident, which hid the UPI link, the QR,
  // and the treasurer contact. A missing lookup must still never fail the page.
  const { data: paymentInfoRows } = await supabase.rpc('get_resident_society_payment_info');
  const upiConfig = (Array.isArray(paymentInfoRows) ? paymentInfoRows[0] : paymentInfoRows) as ResidentPaymentInfo | null | undefined;

  // Free UPI screenshot upload path (alternative to the Razorpay gateway) —
  // RLS already scopes this to the resident's own unit; a missing/errored
  // lookup just means "no submissions to show yet".
  const { data: claims } = await supabase
    .from('resident_payment_claims')
    .select('id, bill_ids, amount, status, review_note, submitted_at, reviewed_at')
    .eq('unit_id', unitId)
    .order('submitted_at', { ascending: false })
    .limit(10)
    .returns<ClaimRow[]>();

  if (unitError || billsError || paymentsError || amcError || levyError) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <PageHeader title="My Flat" />
        <p className="text-[var(--text-sm)] text-[var(--sf-red)]">Failed to load your flat data. Please refresh.</p>
      </div>
    );
  }

  type UnitRow = typeof unit & {
    residents: Array<{ full_name: string; occupancy_type: string; is_primary: boolean; is_active: boolean }>;
  };
  const typedUnit = unit as UnitRow | null;
  const primary = typedUnit?.residents?.find(r => r.is_primary && r.is_active)
    ?? typedUnit?.residents?.find(r => r.is_active)
    ?? null;

  const today = new Date().toISOString().slice(0, 10);
  // Every total here is what the bills still owe, not what they were billed:
  // summariseDues nets off migration 066's amount_settled, so a flat that had
  // part-paid a month is no longer shown — or asked through the UPI link — for
  // the whole of it again. It is fed the complete bill list on purpose.
  const dues = summariseDues(bills ?? [], today);
  const overdueBills = dues.overdue;
  const totalDue = dues.totalDue;

  // Anything not settled is payable. isBillDue() is deliberately narrower — it
  // means "late" — so gating the payment options on it left a resident with an
  // issued bill not yet past its due date reading "All paid up", with no pay
  // button, no QR and no way to upload proof. Paying early is not an error.
  // Overdue still drives the red framing below; this only decides what is offered.
  const payableBills = dues.payable;
  const totalPayable = dues.totalPayable;
  const levyAssessments = levyAssessmentsRaw ?? [];
  const payableLevyAssessments = levyAssessments.filter(a => a.status !== 'PAID' && outstandingLevy(a) > 0.005);
  const totalLevyPayable = payableLevyAssessments.reduce(
    (sumPaise, assessment) => sumPaise + Math.round(outstandingLevy(assessment) * 100),
    0,
  ) / 100;
  const accountOutstanding = Math.round((totalPayable + totalLevyPayable) * 100) / 100;
  const accountCredit = (payments ?? []).reduce(
    (sumPaise, payment) => payment.auto_apply_credit
      ? sumPaise + Math.round(Number(payment.unapplied_amount) * 100)
      : sumPaise,
    0,
  ) / 100;

  // Full bill data for the "choose which months" direction control and the
  // allocate() preview — src/lib/utils/appropriation.ts needs amount_settled
  // and penalty_amount to compute what a payment actually covers.
  const payableBillSummaries: PayableBillSummary[] = payableBills.map(b => ({
    id: b.id,
    label: `${MONTH_LABELS[b.bill_period_month]} ${b.bill_period_year}`,
    bill_period_year: b.bill_period_year,
    bill_period_month: b.bill_period_month,
    payable_amount: Number(b.payable_amount),
    amount_settled: Number(b.amount_settled),
    penalty_amount: Number(b.penalty_amount),
    due_date: b.due_date,
  }));

  // Index the newest collection per levy label for rendering.
  const latestCollectionByLevy = new Map<string, LevyHistoryRow>();
  for (const collection of amcRaw ?? []) {
    const current = latestCollectionByLevy.get(collection.levy_label);
    if (!current || (collection.payment_date ?? '') > (current.payment_date ?? '')) {
      latestCollectionByLevy.set(collection.levy_label, collection);
    }
  }

  // The table below is a 12-month view by design; the totals above are not.
  const recentBills = (bills ?? []).slice(0, RECENT_BILL_MONTHS);

  const payableAccountLevySummaries: PayableAccountLevySummary[] = payableLevyAssessments.map(a => ({
    id: a.id,
    levy_label: labelDisplay(a.levy_label),
    outstanding: outstandingLevy(a),
    created_at: a.created_at,
  }));

  const rawPaid = params.paid;
  const justPaid = (Array.isArray(rawPaid) ? rawPaid[0] : rawPaid) === '1';

  const allPayments = [
    ...(payments ?? []).map(payment => ({
      id: payment.id,
      kind: 'maintenance' as const,
      amount_paid: payment.amount_paid,
      payment_date: payment.payment_date,
      detail: payment.auto_apply_credit ? 'Maintenance payment' : (payment.months_detail ?? 'Maintenance'),
    })),
    ...(amcRaw ?? []).map(collection => ({
      id: collection.id,
      kind: 'levy' as const,
      amount_paid: collection.amount_paid,
      payment_date: collection.payment_date ?? '',
      detail: labelDisplay(collection.levy_label),
    })),
  ].sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.id.localeCompare(a.id));
  const historyPageCount = Math.ceil(allPayments.length / HISTORY_PAGE_SIZE);
  const historyPage = Math.min(requestedHistoryPage, Math.max(1, historyPageCount));
  const historyStart = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const paymentHistory = allPayments.slice(historyStart, historyStart + HISTORY_PAGE_SIZE);

  // Data-principal requests use the privacy contact workflow.
  const societyName = upiConfig?.society_name ?? 'the society';
  const flatNumber = typedUnit?.flat_number ?? '';
  const treasurerMobile = upiConfig?.treasurer_mobile ?? null;
  const dataRequestLink = treasurerMobile
    ? buildWhatsAppLink(treasurerMobile, buildDataAccessRequestMessage({ societyName, flatNumber }))
    : null;
  const consentWithdrawalLink = treasurerMobile
    ? buildWhatsAppLink(treasurerMobile, buildConsentWithdrawalMessage({ societyName, flatNumber }))
    : null;

  // Payment prompts use the same payable-bill set as the displayed balance.
  const canPayOnline = gatewayEnabled(auth.societyId) && accountOutstanding > 0;
  const upiLink = upiConfig?.upi_id
    ? buildUpiLink({
        vpa: upiConfig.upi_id,
        payeeName: upiConfig.society_name ?? societyName,
        amount: accountOutstanding,
        note: `Flat ${flatNumber} maintenance and society charges`,
      })
    : null;

  return (
    <AccountPaymentAmountProvider initialAmount={accountOutstanding}>
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        title={`Flat ${typedUnit?.flat_number ?? '—'}`}
        subtitle={primary ? `${primary.full_name} · ${primary.occupancy_type}` : undefined}
      />

      {/* Dues summary */}
      {justPaid && (
        <p className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sf-green)_30%,transparent)] bg-[color-mix(in_srgb,var(--sf-green)_6%,var(--sf-surface))] px-4 py-2.5 text-[var(--text-xs)] font-medium text-[var(--sf-green)]">
          Payment received — your dues will update within a minute.
        </p>
      )}
      <div className={[
        'rounded-[var(--radius-lg)] border p-4',
        totalDue > 0
          ? 'border-[color-mix(in_srgb,var(--sf-red)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-red)_5%,var(--sf-surface))]'
          : accountOutstanding > 0
            ? 'border-[var(--sf-border)] bg-[var(--sf-surface)]'
            : 'border-[color-mix(in_srgb,var(--sf-green)_30%,transparent)] bg-[color-mix(in_srgb,var(--sf-green)_5%,var(--sf-surface))]',
      ].join(' ')}>
        {accountOutstanding > 0 ? (
          <>
            {totalDue > 0 ? (
              <>
                <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-red)]">Total account balance</p>
                <p className="text-[28px] font-bold text-[var(--sf-red)] tabular mt-0.5">{formatINR(accountOutstanding)}</p>
                <p className="text-[var(--text-xs)] text-[var(--sf-label2)] mt-1">
                  {overdueBills.length} month{overdueBills.length !== 1 ? 's' : ''} overdue
                  {payableBills.length > overdueBills.length
                    ? `, ${payableBills.length - overdueBills.length} not yet due`
                    : ''}
                  {totalLevyPayable > 0 ? ` · ${formatINR(totalLevyPayable)} in AMC` : ''}
                </p>
              </>
            ) : (
              <>
                <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">Total account balance</p>
                <p className="text-[28px] font-bold text-[var(--sf-label)] tabular mt-0.5">{formatINR(accountOutstanding)}</p>
                <p className="text-[var(--text-xs)] text-[var(--sf-label2)] mt-1">
                  {totalPayable > 0 ? `${formatINR(totalPayable)} maintenance` : ''}
                  {totalPayable > 0 && totalLevyPayable > 0 ? ' · ' : ''}
                  {totalLevyPayable > 0 ? `${formatINR(totalLevyPayable)} AMC` : ''}
                </p>
              </>
            )}
            {canPayOnline || upiLink ? (
              <div className="mt-3">
                <PayButtons
                  suggestedAmount={accountOutstanding}
                  canPayOnline={canPayOnline}
                  upiLink={upiLink}
                />
              </div>
            ) : (
              <p className="text-[var(--text-xs)] text-[var(--sf-label2)] mt-2">Please contact the treasurer to pay.</p>
            )}
            {upiConfig?.upi_qr_object_key && (
              <div className="mt-2">
                <UpiQrPanel slug={auth.societySlug} />
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-green)]">All paid up</p>
            <p className="text-[var(--text-xs)] text-[var(--sf-label2)] mt-1">No outstanding maintenance or AMC.</p>
            {upiLink && (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3">
                <p className="mb-2 text-[var(--text-xs)] font-medium text-[var(--sf-label)]">Make an account prepayment</p>
                <PayButtons suggestedAmount={0} canPayOnline={false} upiLink={upiLink} />
              </div>
            )}
            {upiConfig?.upi_qr_object_key && (
              <div className="mt-2">
                <UpiQrPanel slug={auth.societySlug} />
              </div>
            )}
          </>
        )}
      </div>

      {accountCredit > 0.005 && (
        <div className="rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--sf-blue)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-blue)_5%,var(--sf-surface))] p-4">
          <p className="text-[var(--text-xs)] font-medium text-[var(--sf-blue)]">Account credit</p>
          <p className="mt-0.5 text-[22px] font-bold tabular text-[var(--sf-label)]">{formatINR(accountCredit)}</p>
          <p className="mt-1 text-[var(--text-xs)] text-[var(--sf-label2)]">
            Automatically applied to your oldest unpaid maintenance or AMC.
          </p>
        </div>
      )}

      {/* Free UPI screenshot upload — always offered, even with nothing payable.
          With no payable bills this submits as an advance (empty bill_ids,
          migration 066) rather than being hidden behind "All paid up". */}
      <UploadProof
        bills={payableBillSummaries}
        levies={payableAccountLevySummaries}
        suggestedAmount={accountOutstanding}
      />

      {/* Payment submissions (screenshot-based claims) */}
      {(claims ?? []).length > 0 && (
        <div>
          <h2 className="text-[var(--text-sm)] font-semibold text-[var(--sf-label)] mb-2">Payment Submissions</h2>
          <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] divide-y divide-[var(--sf-divider)]">
            {(claims ?? []).map(claim => (
              <div key={claim.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-1.5">
                <div>
                  <p className="text-[var(--text-sm)] font-semibold tabular text-[var(--sf-label)]">
                    {formatINR(Number(claim.amount))}
                  </p>
                  <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">
                    Submitted {formatDate(claim.submitted_at)}
                  </p>
                  {claim.status === 'rejected' && claim.review_note && (
                    <p className="text-[var(--text-xs)] text-[var(--sf-red)] mt-0.5">{claim.review_note}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={CLAIM_STATUS_BADGE[claim.status]}>{claim.status}</Badge>
                  {claim.status === 'pending' && <RetractClaimButton claimId={claim.id} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Levy tiles — migration 067's real per-unit obligation row, not a
          derived sum of past collections. Only levies actually raised for
          this flat appear here; a configured levy that was never raised has
          nothing for the resident to owe or pay. */}
      {levyAssessments.length > 0 && (
        <div>
          <h2 className="text-[var(--text-sm)] font-semibold text-[var(--sf-label)] mb-2">AMC</h2>
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-3 gap-2">
            {levyAssessments.map(a => {
              const settled = Number(a.amount_settled);
              const amount = Number(a.amount);
              const status = a.status === 'PAID' ? 'paid' : settled > 0 ? 'partial' : 'pending';
              const latestCollection = latestCollectionByLevy.get(a.levy_label);
              return (
                <div
                  key={a.id}
                  className={[
                    'rounded-[var(--radius-md)] border p-3',
                    status === 'paid'
                      ? 'border-[color-mix(in_srgb,var(--sf-green)_30%,transparent)] bg-[color-mix(in_srgb,var(--sf-green)_6%,var(--sf-surface))]'
                      : status === 'partial'
                        ? 'border-[color-mix(in_srgb,var(--sf-orange)_30%,transparent)] bg-[color-mix(in_srgb,var(--sf-orange)_6%,var(--sf-surface))]'
                      : 'border-[var(--sf-border)] bg-[var(--sf-surface)]',
                  ].join(' ')}
                >
                  <p className="break-words text-[var(--text-xs)] font-semibold text-[var(--sf-label)]">{labelDisplay(a.levy_label)}</p>
                  <p className="text-[var(--text-sm)] font-bold tabular mt-0.5 text-[var(--sf-label)]">
                    {formatINR(amount)}
                  </p>
                  {status !== 'pending' ? (
                    <p className={`text-[var(--text-xs)] mt-1 font-medium ${status === 'paid' ? 'text-[var(--sf-green)]' : 'text-[var(--sf-orange)]'}`}>
                      {status === 'paid' ? '✓ Paid' : `◐ Partial · ${formatINR(outstandingLevy(a))} due`}{latestCollection?.payment_date ? ` · ${formatDate(latestCollection.payment_date)}` : ''}
                    </p>
                  ) : (
                    <p className="text-[var(--text-xs)] text-[var(--sf-label3)] mt-1">Pending</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment history */}
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
          <h2 className="text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">Payment History</h2>
          {allPayments.length > 0 && (
            <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">
              {allPayments.length} payment{allPayments.length !== 1 ? 's' : ''} · Page {historyPage} of {historyPageCount}
            </p>
          )}
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] overflow-hidden">
          {paymentHistory.length === 0 ? (
            <p className="px-4 py-8 text-center text-[var(--text-sm)] text-[var(--sf-label3)]">No payments recorded.</p>
          ) : (
            <>
              <p className="px-4 pt-2 text-[var(--text-xs)] text-[var(--sf-label3)] sm:hidden">Scroll horizontally to view all columns →</p>
              <div
                role="region"
                aria-label="Payment history table. Scroll horizontally to view all columns."
                tabIndex={0}
                className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sf-blue)]"
              >
                <table className="w-full min-w-[440px] text-[var(--text-sm)]">
                  <thead>
                    <tr className="border-b border-[var(--sf-divider)] text-left">
                      <th className="px-4 py-2.5 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)]">Date</th>
                      <th className="px-4 py-2.5 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)]">For</th>
                      <th className="px-4 py-2.5 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--sf-divider)]">
                    {paymentHistory.map(p => (
                      <tr key={`${p.kind}-${p.id}`} className="hover:bg-[var(--sf-bg)]">
                        <td className="px-4 py-3 text-[var(--sf-label2)] whitespace-nowrap">{formatDate(p.payment_date)}</td>
                        <td className="px-4 py-3 text-[var(--sf-label)]">{p.detail}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular text-[var(--sf-label)]">{formatINR(Number(p.amount_paid))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {historyPageCount > 1 && (
                <nav
                  aria-label="Payment history pagination"
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--sf-divider)] px-4 py-3"
                >
                  <p className="text-[var(--text-xs)] text-[var(--sf-label2)]">
                    Showing {historyStart + 1}–{Math.min(historyStart + HISTORY_PAGE_SIZE, allPayments.length)} of {allPayments.length}
                  </p>
                  <div className="flex gap-2">
                    {historyPage > 1 && (
                      <Link
                        href={`?history_page=${historyPage - 1}`}
                        aria-label={`Go to payment history page ${historyPage - 1}`}
                        className="rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-1.5 text-[var(--text-xs)] font-medium text-[var(--sf-label2)] hover:bg-[var(--sf-bg)] transition-colors"
                      >
                        Previous
                      </Link>
                    )}
                    {historyPage < historyPageCount && (
                      <Link
                        href={`?history_page=${historyPage + 1}`}
                        aria-label={`Go to payment history page ${historyPage + 1}`}
                        className="rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-1.5 text-[var(--text-xs)] font-medium text-[var(--sf-label2)] hover:bg-[var(--sf-bg)] transition-colors"
                      >
                        Next
                      </Link>
                    )}
                  </div>
                </nav>
              )}
            </>
          )}
        </div>
      </div>

      {/* Bill status (last 12 months) */}
      {recentBills.length > 0 && (
        <div>
          <h2 className="text-[var(--text-sm)] font-semibold text-[var(--sf-label)] mb-2">Bill Status — Last 12 Months</h2>
          <p className="px-1 pb-1 text-[var(--text-xs)] text-[var(--sf-label3)] sm:hidden">Scroll horizontally to view all columns →</p>
          <div
            role="region"
            aria-label="Bill status table. Scroll horizontally to view all columns."
            tabIndex={0}
            className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sf-blue)]"
          >
            <table className="w-full min-w-[400px] text-[var(--text-sm)]">
              <thead>
                <tr className="border-b border-[var(--sf-divider)] text-left">
                  <th className="px-4 py-2.5 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)]">Month</th>
                  <th className="px-4 py-2.5 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)]">Status</th>
                  <th className="px-4 py-2.5 text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--sf-divider)]">
                {recentBills.map(b => (
                  <tr key={`${b.bill_period_year}-${b.bill_period_month}`} className="hover:bg-[var(--sf-bg)]">
                    <td className="px-4 py-3 text-[var(--sf-label2)] whitespace-nowrap">
                      {MONTH_LABELS[b.bill_period_month]} {b.bill_period_year}
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={b.status === 'PAID' ? 'green' : b.status === 'OVERDUE' ? 'red' : 'yellow'}>
                        {b.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular text-[var(--sf-label)]">
                      {formatINR(isPayableBillStatus(b.status) ? outstandingAmount(b) : 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Privacy & your data (DPDP Act 2023) */}
      <div>
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--sf-label)] mb-2">Privacy &amp; Your Data</h2>
        <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 space-y-3">
          <p className="text-[var(--text-xs)] text-[var(--sf-label2)]">
            Under the DPDP Act 2023, you can request a copy of your data or withdraw your consent for
            email/WhatsApp notifications at any time. Read the full{' '}
            <a
              href={auth.societySlug ? `/privacy?society=${encodeURIComponent(auth.societySlug)}` : '/privacy'}
              className="text-[var(--sf-blue)] hover:underline"
            >
              Privacy Policy
            </a>.
          </p>
          <div className="flex flex-wrap gap-2">
            {dataRequestLink ? (
              <a
                href={dataRequestLink}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-1.5 text-[var(--text-xs)] font-medium text-[var(--sf-label)] hover:bg-black/[0.03] transition-colors"
              >
                Request my data
              </a>
            ) : (
              <span className="rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-1.5 text-[var(--text-xs)] font-medium text-[var(--sf-label3)] cursor-not-allowed" title="Treasurer contact number not configured">
                Request my data
              </span>
            )}
            {consentWithdrawalLink ? (
              <a
                href={consentWithdrawalLink}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-1.5 text-[var(--text-xs)] font-medium text-[var(--sf-label)] hover:bg-black/[0.03] transition-colors"
              >
                Withdraw notification consent
              </a>
            ) : (
              <span className="rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-1.5 text-[var(--text-xs)] font-medium text-[var(--sf-label3)] cursor-not-allowed" title="Treasurer contact number not configured">
                Withdraw notification consent
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
    </AccountPaymentAmountProvider>
  );
}
