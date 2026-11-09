import type { BillStatus } from '@/types/database';

export function invoiceDateForPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function addBillingDays(invoiceDate: string, windowDays: number): string {
  const date = new Date(`${invoiceDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.trunc(windowDays) - 1));
  return date.toISOString().slice(0, 10);
}

export function billingDatesForPeriod(year: number, month: number, windowDays: number) {
  const invoiceDate = invoiceDateForPeriod(year, month);
  return {
    invoiceDate,
    dueDate: addBillingDays(invoiceDate, windowDays),
  };
}

export function missingBilledUnitIds(activeUnitIds: string[], billedUnitIds: string[]): string[] {
  const billed = new Set(billedUnitIds);
  return activeUnitIds.filter(id => !billed.has(id));
}

export function isBillDue(
  bill: { status: string; due_date: string },
  asOn: string,
): boolean {
  return bill.status === 'OVERDUE'
    || (bill.status === 'ISSUED' && bill.due_date < asOn);
}

/**
 * Oldest billing period first. The single ordering used wherever bills are
 * consumed in age order — the dues notice and payment appropriation both sort
 * through this so they can never disagree about which month is "oldest".
 *
 * The id tie-break cannot trigger for one unit (a unit has at most one bill per
 * period) but keeps the order deterministic across a mixed-unit list and across
 * runs, which matters because appropriation decisions are financial records.
 */
export function compareBillPeriod(
  a: { bill_period_year: number; bill_period_month: number; id?: string },
  b: { bill_period_year: number; bill_period_month: number; id?: string },
): number {
  return (a.bill_period_year - b.bill_period_year)
    || (a.bill_period_month - b.bill_period_month)
    || (a.id ?? '').localeCompare(b.id ?? '');
}

/**
 * What a bill still owes: its generated payable amount less whatever has
 * already been settled against it (migration 066).
 *
 * The single definition of "outstanding". Dues totals, the dues notice and
 * appropriation all measure a bill this way, and any of them summing raw
 * payable_amount instead re-bills money the flat has already paid. Never
 * negative, even if data drifted; rounded to paise, never compared as a float.
 */
export function outstandingAmount(
  bill: { payable_amount: number | string; amount_settled: number | string },
): number {
  const remaining = Number(bill.payable_amount) - Number(bill.amount_settled);
  return remaining > 0 ? Math.round(remaining * 100) / 100 : 0;
}

export function automaticPenalty(baseAmount: number, ratePercent: number): number {
  return Math.round((baseAmount * Math.max(0, ratePercent) / 100) * 100) / 100;
}

export function overdueBillUpdate(
  bill: { status: BillStatus; due_date: string; base_amount: number; penalty_amount: number },
  ratePercent: number,
  asOn: string,
): { status: 'OVERDUE'; penalty_amount: number } | null {
  if (bill.status !== 'ISSUED' || bill.due_date >= asOn) return null;
  return {
    status: 'OVERDUE',
    penalty_amount: bill.penalty_amount > 0
      ? bill.penalty_amount
      : automaticPenalty(bill.base_amount, ratePercent),
  };
}

/**
 * The only statuses a bill can be paid against.
 *
 * DRAFT is not yet issued to anybody and CANCELLED has been withdrawn, so
 * neither is money a resident owes. `status !== 'PAID'` looked equivalent and
 * is not: it let both through, and the resident surface was the only place
 * using it. That put draft and cancelled months in the resident's dues total,
 * in the UPI amount, in the gateway's bill list and in the proof-form picker —
 * while every treasurer-side view and `assert_payable_bills` counted only these
 * two. The disagreement was not cosmetic: the settlement gate rejects anything
 * outside this set, so paying or claiming such a month could never succeed.
 */
export const PAYABLE_BILL_STATUSES = ['ISSUED', 'OVERDUE'] as const;

export function isPayableBillStatus(status: string): boolean {
  return (PAYABLE_BILL_STATUSES as readonly string[]).includes(status);
}

/** The shape any dues calculation needs from a bill. */
export type DuesBill = {
  status: string;
  due_date: string;
  payable_amount: number | string;
  amount_settled: number | string;
};

export type DuesSummaryOf<T> = {
  /** Everything with a balance left, whether or not it is late yet. */
  payable: T[];
  /** The subset that is past its due date — what "arrears" means. */
  overdue: T[];
  totalPayable: number;
  totalDue: number;
};

/** Sum all live bill balances into payable and overdue totals. */
export function summariseDues<T extends DuesBill>(bills: T[], asOn: string): DuesSummaryOf<T> {
  const payable: T[] = [];
  const overdue: T[] = [];
  let totalPayable = 0;
  let totalDue = 0;

  for (const bill of bills) {
    const outstanding = outstandingAmount(bill);
    if (!isPayableBillStatus(bill.status) || outstanding === 0) continue;
    payable.push(bill);
    totalPayable += outstanding;
    if (isBillDue(bill, asOn)) {
      overdue.push(bill);
      totalDue += outstanding;
    }
  }

  return {
    payable,
    overdue,
    totalPayable: Math.round(totalPayable * 100) / 100,
    totalDue: Math.round(totalDue * 100) / 100,
  };
}
