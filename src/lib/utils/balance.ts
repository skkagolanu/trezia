// Pure computation behind the Balance Sheet (Receipts & Payments statement).
// The books are cash-basis and single-entry, and transaction records do not
// reach back to the society's first day (plus a permanent Sep 2024 – Apr 2025
// expense gap), so balances are anchored to treasurer-recorded
// balance_snapshots rather than computed from zero.

export interface DatedAmount {
  /** ISO date (YYYY-MM-DD) or null when the record has no date (some levies). */
  date: string | null;
  amount: number;
}

export interface CategorisedAmount extends DatedAmount {
  category: string;
}

export interface SnapshotPoint {
  date: string;
  /** bank_balance + cash_in_hand as recorded by the treasurer. */
  total: number;
}

export function inRange(date: string | null, from?: string, to?: string): boolean {
  if (date === null) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export function sumInRange(rows: DatedAmount[], from?: string, to?: string): number {
  let s = 0;
  for (const r of rows) if (inRange(r.date, from, to)) s += r.amount;
  return s;
}

export function countInRange(rows: DatedAmount[], from?: string, to?: string): number {
  let n = 0;
  for (const r of rows) if (inRange(r.date, from, to)) n++;
  return n;
}

/** Total of records that carry no date at all — invisible to any bounded range. */
export function undatedTotal(rows: DatedAmount[]): number {
  let s = 0;
  for (const r of rows) if (r.date === null) s += r.amount;
  return s;
}

export function sumByCategory(
  rows: CategorisedAmount[],
  from?: string,
  to?: string,
): Array<{ category: string; total: number }> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!inRange(r.date, from, to)) continue;
    map.set(r.category, (map.get(r.category) ?? 0) + r.amount);
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Whether a bill counts as receivable on a given date. OVERDUE always counts;
 * ISSUED counts only after its stored due date, matching v_dues_summary.
 */
export function isDueAsOn(
  bill: { status: string; due_date: string },
  asOn: string,
): boolean {
  return bill.status === 'OVERDUE'
    || (bill.status === 'ISSUED' && bill.due_date < asOn);
}

/** Status to restore when a payment no longer covers a bill period. */
export function unpaidBillStatusAsOn(
  year: number,
  month: number,
  asOn: string,
): 'OVERDUE' | 'ISSUED' {
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  return periodStart < `${asOn.slice(0, 7)}-01` ? 'OVERDUE' : 'ISSUED';
}

export interface StatementInput {
  from?: string;
  to?: string;
  snapshots: SnapshotPoint[];
  /** Every inflow: maintenance payments, AMC/special levies, other income. */
  receipts: DatedAmount[];
  /** Every outflow: expenditures. */
  payments: DatedAmount[];
}

export interface Statement {
  /** amount is null when no snapshot exists before `from` to anchor on. */
  opening: { amount: number | null; anchorDate: string | null };
  receiptsTotal: number;
  paymentsTotal: number;
  net: number;
  /** null whenever opening is unknown. */
  closing: number | null;
  /** Latest in-period snapshot vs the balance computed from transactions. */
  reconciliation: {
    snapshotDate: string;
    recorded: number;
    computed: number;
    difference: number;
  } | null;
}

export function computeStatement({ from, to, snapshots, receipts, payments }: StatementInput): Statement {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));

  // Opening anchor: latest snapshot strictly before `from` (a snapshot on day D
  // records the balance at the end of D), rolled forward by the transactions
  // strictly between the anchor date and the period start.
  let opening: Statement['opening'] = { amount: null, anchorDate: null };
  if (from) {

    const anchor = sorted.findLast(s => s.date < from);
    if (anchor) {
      let delta = 0;
      for (const r of receipts) if (r.date !== null && r.date > anchor.date && r.date < from) delta += r.amount;
      for (const p of payments) if (p.date !== null && p.date > anchor.date && p.date < from) delta -= p.amount;
      opening = { amount: anchor.total + delta, anchorDate: anchor.date };
    }
  }

  const receiptsTotal = sumInRange(receipts, from, to);
  const paymentsTotal = sumInRange(payments, from, to);
  const net = receiptsTotal - paymentsTotal;
  const closing = opening.amount === null ? null : opening.amount + net;

  let reconciliation: Statement['reconciliation'] = null;
  if (opening.amount !== null) {
    const snap = sorted.findLast(s => (!to || s.date <= to) && (!from || s.date >= from));
    if (snap) {
      const computed =
        opening.amount + sumInRange(receipts, from, snap.date) - sumInRange(payments, from, snap.date);
      reconciliation = {
        snapshotDate: snap.date,
        recorded: snap.total,
        computed,
        difference: snap.total - computed,
      };
    }
  }

  return { opening, receiptsTotal, paymentsTotal, net, closing, reconciliation };
}
