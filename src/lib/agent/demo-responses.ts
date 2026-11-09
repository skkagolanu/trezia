import { v_dues_summary, v_monthly_collections, expenditures } from '@/lib/demo/data';

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

// computed from the same DEMO_DATA every other demo page reads, so numbers
// stay consistent with what a visitor sees elsewhere in the app. Pure and
// unit-tested — no LLM call, no network, nothing related to GROQ_API_KEY is
// ever touched for these.
export function getDemoReply(userText: string): string {
  const t = userText.toLowerCase();

  if (/\b(due|dues|defaulter|pending|owe|overdue)\b/.test(t)) {
    const rows = v_dues_summary as Array<{ flat_number: string; total_due: number }>;
    const total = rows.reduce((s, r) => s + r.total_due, 0);
    return `${rows.length} flats have pending dues totalling ${inr(total)}. `
      + `(Live demo — sign in with your own society to see the full interactive dues table.)`;
  }

  if (/\b(collect|collection|expense|expenses|summary|spent|spend)\b/.test(t)) {
    const latest = v_monthly_collections[v_monthly_collections.length - 1];
    const monthPrefix = latest.month.slice(0, 7);
    const monthExpenses = expenditures
      .filter(e => e.expense_date.startsWith(monthPrefix))
      .reduce((s, e) => s + e.amount, 0);
    const net = latest.total_collected - monthExpenses;
    return `This month: collected ${inr(latest.total_collected)} from ${latest.payment_count} payments, `
      + `spent ${inr(monthExpenses)}, net ${inr(net)}. `
      + `(Live demo — sign in with your own society for real numbers.)`;
  }

  if (/\b(balance|cash|bank|opening|closing)\b/.test(t)) {
    const totalCollected = v_monthly_collections.reduce((s, m) => s + m.total_collected, 0);
    const totalExpenses = expenditures.reduce((s, e) => s + e.amount, 0);
    return `Cash position this demo period: ${inr(totalCollected)} collected, ${inr(totalExpenses)} spent, `
      + `net ${inr(totalCollected - totalExpenses)}. `
      + `(Live demo — the real Balance Sheet page shows opening/closing balances anchored to recorded snapshots.)`;
  }

  return "This is a live demo of the Trezia assistant — try asking about pending dues, "
    + "this month's collections, or the cash balance. Sign in with your own society's data for the full "
    + "read-only assistant (payment history, expense search, and more).";
}
