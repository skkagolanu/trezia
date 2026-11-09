/**
 * Pure helpers for the dues-notice PDF. Kept here (no DB / React deps) so they
 * are unit-testable under the src/lib/utils coverage scope.
 */
import { compareBillPeriod, isPayableBillStatus } from '@/lib/utils/billing';

/** Add `days` calendar days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Return every live payable maintenance balance, sorted oldest-first. A dues
 * notice is a flat-account statement, so it must match the amount residents
 * can actually pay rather than hide an issued bill until its due date.
 */
export function selectUnpaidBills<T extends { bill_period_year: number; bill_period_month: number; status: string; due_date: string }>(
  bills: T[],
): T[] {
  return bills.filter(bill => isPayableBillStatus(bill.status)).sort(compareBillPeriod);
}
