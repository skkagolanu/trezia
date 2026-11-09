export const metadata = { title: 'Advances Ledger · Trezia' };

import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import Tooltip from '@/components/ui/Tooltip';
import Badge, { paymentModeBadge } from '@/components/ui/Badge';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import SettleAdvanceButton, { type BillOption } from './SettleAdvanceButton';
import ReconcileLegacySettlement from './ReconcileLegacySettlement';
import type { AdvanceSettlement } from '@/types/database';

interface AdvanceRow {
  id: string;
  date: string;
  flatOrPayee: string;
  /** The real way the money arrived (UPI, CASH, ADVANCE, ...). Undefined for expense rows. */
  method?: string;
  originalAmount: number;
  settledAmount: number;
  remaining: number;
  settlements: AdvanceSettlement[];
  /** Candidate bills this advance could settle, for PAYMENT rows only. */
  bills: BillOption[];
}

export default async function AdvancesPage() {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_write')) redirect('/access-denied');

  const supabase = await createClient();

  const [paymentsResult, expensesResult, settlementsResult] = await Promise.all([

    supabase
      .from('payments')
      .select('id, unit_id, payment_date, amount_paid, unapplied_amount, payment_mode, units!payments_unit_same_society(flat_number)')
      .gt('unapplied_amount', 0)
      .eq('is_voided', false)
      .order('payment_date', { ascending: false }),
    supabase
      .from('expenditures')
      .select('id, expense_date, amount, payee_name, description')
      .eq('category', 'ADVANCE_PAYMENT')
      .eq('is_voided', false)
      .order('expense_date', { ascending: false }),
    supabase
      .from('advance_settlements')
      .select('*')
      .eq('is_voided', false),
  ]);
  if (paymentsResult.error || expensesResult.error || settlementsResult.error) {
    throw new Error('The advances ledger could not be loaded. Retry to fetch authoritative balances.');
  }
  const unappliedPayments = paymentsResult.data;
  const advanceExpenses = expensesResult.data;
  const settlementsRaw = settlementsResult.data;

  const settlements = (settlementsRaw ?? []) as AdvanceSettlement[];
  const settlementsByAdvance = new Map<string, AdvanceSettlement[]>();
  const settledBillIdsByPayment = new Map<string, Set<string>>();
  for (const settlement of settlements) {
    const key = `${settlement.advance_kind}:${settlement.advance_id}`;
    const rows = settlementsByAdvance.get(key) ?? [];
    rows.push(settlement);
    settlementsByAdvance.set(key, rows);
    if (settlement.advance_kind === 'PAYMENT' && settlement.bill_id) {
      const billIds = settledBillIdsByPayment.get(settlement.advance_id) ?? new Set<string>();
      billIds.add(settlement.bill_id);
      settledBillIdsByPayment.set(settlement.advance_id, billIds);
    }
  }
  const settlementsFor = (kind: 'PAYMENT' | 'EXPENSE', id: string) =>
    settlementsByAdvance.get(`${kind}:${id}`) ?? [];

  const unresolvedLegacy = settlements.filter(settlement =>
    settlement.advance_kind === 'PAYMENT'
    && settlement.bill_id == null
    && settlement.levy_assessment_id == null
    && settlement.legacy_resolution == null,
  );
  const legacyPaymentIds = [...new Set(unresolvedLegacy.map(settlement => settlement.advance_id))];
  const { data: legacyPayments, error: legacyPaymentsError } = legacyPaymentIds.length
    ? await supabase
        .from('payments')
        .select('id, unit_id, payment_date, payment_mode, units!payments_unit_same_society(flat_number)')
        .in('id', legacyPaymentIds)
        .eq('is_voided', false)
    : { data: [], error: null };
  if (legacyPaymentsError) {
    throw new Error('Legacy settlement details could not be loaded. Retry before reconciling.');
  }
  const legacyPaymentMap = new Map((legacyPayments ?? []).map(payment => [payment.id, payment]));

  const paymentUnitIds = [...new Set([
    ...(unappliedPayments ?? []).map(payment => payment.unit_id),
    ...(legacyPayments ?? []).map(payment => payment.unit_id),
  ])];
  const { data: candidateBillsRaw, error: candidateBillsError } = paymentUnitIds.length
    ? await supabase
        .from('bills')
        .select('id, unit_id, bill_period_year, bill_period_month, payable_amount, amount_settled')
        .in('unit_id', paymentUnitIds)
        .in('status', ['ISSUED', 'OVERDUE'])
        .eq('is_voided', false)
    : { data: [], error: null };
  if (candidateBillsError) {
    throw new Error('Candidate bill balances could not be loaded. Retry before settling an advance.');
  }
  const billsByUnit = new Map<string, BillOption[]>();
  for (const b of candidateBillsRaw ?? []) {
    const list = billsByUnit.get(b.unit_id) ?? [];
    list.push({
      id: b.id,
      label: `${b.bill_period_month}/${b.bill_period_year}`,
      remaining: Number(b.payable_amount) - Number(b.amount_settled),
    });
    billsByUnit.set(b.unit_id, list);
  }

  // unapplied_amount is the canonical remaining balance now — the RPC updates
  // it in the same transaction as the settlement insert, so there is nothing
  // left to recompute here for PAYMENT rows. settledAmount stays derived from
  // the settlement trail for display, matching how expense rows still work.
  const paymentRows: AdvanceRow[] = (unappliedPayments ?? []).map(p => {
    const s = settlementsFor('PAYMENT', p.id);
    const settledAmount = s.reduce((sum, x) => sum + Number(x.settled_amount), 0);
    return {
      id: p.id,
      date: p.payment_date,
      flatOrPayee: (p.units as unknown as { flat_number: string } | null)?.flat_number ?? '—',
      method: p.payment_mode,
      originalAmount: Number(p.amount_paid),
      settledAmount,
      remaining: Number(p.unapplied_amount),
      settlements: s,
      // Migration 072 allows different credits to contribute to one bill.
      // Only suppress a bill already reached by this same receipt, which keeps
      // a retried manual allocation from duplicating its settlement row.
      bills: (billsByUnit.get(p.unit_id) ?? []).filter(
        bill => !settledBillIdsByPayment.get(p.id)?.has(bill.id),
      ),
    };
  });

  const expenseRows: AdvanceRow[] = (advanceExpenses ?? []).map(e => {
    const s = settlementsFor('EXPENSE', e.id);
    const settledAmount = s.reduce((sum, x) => sum + Number(x.settled_amount), 0);
    return {
      id: e.id,
      date: e.expense_date,
      flatOrPayee: e.payee_name ?? e.description,
      originalAmount: Number(e.amount),
      settledAmount,
      remaining: Number(e.amount) - settledAmount,
      settlements: s,
      bills: [],
    };
  }).filter(r => r.remaining > 0.005 || r.settlements.length > 0);

  const legacyRows = unresolvedLegacy.flatMap(settlement => {
    const payment = legacyPaymentMap.get(settlement.advance_id);
    if (!payment) return [];
    return [{
      settlement,
      date: payment.payment_date,
      flatNumber: (payment.units as unknown as { flat_number: string } | null)?.flat_number ?? '—',
      method: payment.payment_mode,
      bills: (billsByUnit.get(payment.unit_id) ?? []).filter(bill => bill.remaining + 0.005 >= Number(settlement.settled_amount)),
    }];
  });

  return (
    <div className="flex flex-col">
      <PageHeader title="Advances Ledger" />

      <div className="flex-1 p-6 space-y-6">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-sf-label2">
          <span>Unapplied payments and expense advances</span>
          <Tooltip text="Shows money not yet applied to maintenance or AMC, plus expense advances that still need settlement." />
        </div>

        <Card title="Legacy settlements needing reconciliation">
          {legacyRows.length > 0 ? <div className="overflow-x-auto"><table className="w-full text-[14px]"><thead><tr className="border-b border-black/[0.06] text-left"><th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Date</th><th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Flat</th><th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Recorded against</th><th className="px-4 py-3 text-right text-[13px] font-semibold text-sf-label2">Amount</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-black/[0.04]">{legacyRows.map(row => <tr key={row.settlement.id}><td className="px-4 py-3.5 whitespace-nowrap text-sf-label2">{formatDate(row.date)}</td><td className="px-4 py-3.5 text-sf-label">{row.flatNumber}</td><td className="px-4 py-3.5 text-sf-label2">{row.settlement.settled_against}</td><td className="px-4 py-3.5 text-right font-semibold text-sf-label">{formatINR(Number(row.settlement.settled_amount))}</td><td className="px-4 py-3.5"><ReconcileLegacySettlement settlementId={row.settlement.id} bills={row.bills} /></td></tr>)}</tbody></table></div> : <p className="py-6 text-center text-[14px] text-sf-label3">No unresolved legacy payment settlements.</p>}
        </Card>

        <AdvanceTable title="Unapplied Payments" kind="PAYMENT" columnLabel="Flat" rows={paymentRows} showMethod />
        <AdvanceTable title="Expense Advances" kind="EXPENSE" columnLabel="Payee" rows={expenseRows} />
      </div>
    </div>
  );
}

function AdvanceTable({ title, kind, columnLabel, rows, showMethod }: { title: string; kind: 'PAYMENT' | 'EXPENSE'; columnLabel: string; rows: AdvanceRow[]; showMethod?: boolean }) {
  return (
    <Card title={title}>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-black/[0.06] text-left">
                <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Date</th>
                <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">{columnLabel}</th>
                {showMethod && <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Method</th>}
                <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Original</th>
                <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Settled</th>
                <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2 text-right">Remaining</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-sf-bg">
                  <td className="px-4 py-3.5 text-sf-label2 whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="px-4 py-3.5 text-sf-label">{r.flatOrPayee}</td>
                  {showMethod && (
                    <td className="px-4 py-3.5">
                      {r.method && <Badge color={paymentModeBadge(r.method)}>{r.method}</Badge>}
                    </td>
                  )}
                  <td className="px-4 py-3.5 text-right text-sf-label">{formatINR(r.originalAmount)}</td>
                  <td className="px-4 py-3.5 text-right text-sf-green">{formatINR(r.settledAmount)}</td>
                  <td className={`px-4 py-3.5 text-right font-semibold ${r.remaining > 0 ? 'text-sf-red' : 'text-sf-label3'}`}>
                    {formatINR(r.remaining)}
                  </td>
                  <td className="px-4 py-3.5">
                    {r.remaining > 0.005 && (
                      <SettleAdvanceButton advanceKind={kind} advanceId={r.id} remaining={r.remaining} bills={r.bills} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-6 text-center text-[14px] text-sf-label3">No unsettled advances.</p>
      )}
    </Card>
  );
}
