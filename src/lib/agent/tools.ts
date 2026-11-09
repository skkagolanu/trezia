import { tool } from 'ai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { computeLeanBalanceSummary } from '@/lib/reports/balance-summary';
import { fetchAll } from '@/lib/supabase/fetch-all';
import type { ExpenseCategory } from '@/types/database';
import { isBillDue } from '@/lib/utils/billing';

// ─── READ TOOLS ONLY — no write access ───────────────────────────────────────

const checkDuesSchema = z.object({
  flat_number: z.string().optional()
    .describe('Specific flat number e.g. "204". Omit to get all pending flats.'),
});

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const checkDues = tool({
  description: 'Check which flats have pending maintenance dues. Use when the user asks who has not paid, defaulters, or dues for a flat. For a specific flat it returns the exact unpaid months — report those, never guess a month.',
  inputSchema: checkDuesSchema,
  execute: async ({ flat_number }: z.infer<typeof checkDuesSchema>) => {
    const sb = await createClient();

    // Specific flat: return the actual unpaid bill periods so the model never invents a month.
    // OVERDUE bills always count; an ISSUED bill becomes due only after its
    // editable due date, even if the daily lifecycle job has not run yet.
    if (flat_number) {
      const { data: unit } = await sb.from('units').select('id').eq('flat_number', flat_number).single();
      if (!unit) return { error: `Flat ${flat_number} not found.` };
      const { data: bills } = await sb
        .from('bills')
        .select('bill_period_year, bill_period_month, status, due_date, payable_amount')
        .eq('unit_id', (unit as { id: string }).id)
        .eq('is_voided', false)
        .in('status', ['OVERDUE', 'ISSUED']);
      const today = new Date().toISOString().slice(0, 10);
      const unpaid = ((bills ?? []) as Record<string, unknown>[])
        .filter(b => isBillDue({ status: String(b.status), due_date: String(b.due_date) }, today))
        .sort((a, b) => (Number(a.bill_period_year) - Number(b.bill_period_year))
          || (Number(a.bill_period_month) - Number(b.bill_period_month)));
      if (!unpaid.length) return { result: `Flat ${flat_number} has no pending dues.` };
      const total = unpaid.reduce((s, b) => s + Number(b.payable_amount), 0);
      return {
        flat: flat_number,
        unpaid_months: unpaid.map(b => `${MONTH_ABBR[Number(b.bill_period_month) - 1]} ${b.bill_period_year}`),
        months_count: unpaid.length,
        total_due: `₹${total.toLocaleString('en-IN')}`,
        // Structured for the inline dues card (MessageList) — the string fields above
        // stay for the model's own narration, unchanged for backward compatibility.
        rows: [{ flat: flat_number, resident: null, monthsOverdue: unpaid.length, totalDue: total }],
      };
    }

    // All flats: the dues summary view, defaulters only.
    const { data, error } = await sb.from('v_dues_summary').select('*').order('flat_number');
    if (error) return { error: error.message };
    const due = (data ?? []).filter((r: Record<string, unknown>) => Number(r.total_due ?? 0) > 0);
    if (!due.length) return { result: 'No pending dues found.' };
    return {
      result: due.map((r: Record<string, unknown>) =>
        `Flat ${r.flat_number} (${(r.primary_resident as string) ?? 'Unknown'}): ` +
        `${r.unpaid_months} month(s) overdue — ₹${Number(r.total_due ?? 0).toLocaleString('en-IN')} due`
      ).join('\n'),
      count: due.length,
      // Structured for the inline dues card — kept alongside `result` for the model's narration.
      rows: due.map((r: Record<string, unknown>) => ({
        flat: r.flat_number as string,
        resident: (r.primary_resident as string) ?? null,
        monthsOverdue: Number(r.unpaid_months ?? 0),
        totalDue: Number(r.total_due ?? 0),
      })),
    };
  },
});

const lookupPaymentHistorySchema = z.object({
  flat_number: z.string().describe('Flat number e.g. "307"'),
  limit: z.number().min(1).max(50).default(5).describe('Number of recent payments to return (max 50)'),
});

const lookupPaymentHistory = tool({
  description: 'Look up recent payments for a flat.',
  inputSchema: lookupPaymentHistorySchema,
  execute: async ({ flat_number, limit }: z.infer<typeof lookupPaymentHistorySchema>) => {
    const sb = await createClient();
    const { data: unit } = await sb
      .from('units').select('id').eq('flat_number', flat_number).single();
    if (!unit) return { error: `Flat ${flat_number} not found.` };
    const { data } = await sb
      .from('payments')
      .select('id, receipt_number, amount_paid, payment_mode, payment_date, months_covered, months_detail')
      .eq('unit_id', unit.id)
      .eq('is_voided', false)
      .order('payment_date', { ascending: false })
      .limit(limit);
    if (!data?.length) return { result: `No payments found for Flat ${flat_number}.` };
    return {
      payments: (data as Record<string, unknown>[]).map(p => ({
        receipt_number: p.receipt_number,
        amount:         `₹${Number(p.amount_paid).toLocaleString('en-IN')}`,
        mode:           p.payment_mode,
        date:           p.payment_date,
        months:         p.months_detail ?? p.months_covered,
      })),
    };
  },
});

const getMonthSummarySchema = z.object({
  month: z.string().optional()
    .describe('Month in YYYY-MM format. Defaults to current month if omitted.'),
});

const getMonthSummary = tool({
  description: 'Get a summary of collections and expenses for the current or a specific month.',
  inputSchema: getMonthSummarySchema,
  execute: async ({ month }: z.infer<typeof getMonthSummarySchema>) => {
    const target = month ?? new Date().toISOString().slice(0, 7);
    const [y, m] = target.split('-').map(Number);
    // First day of the next month — used as an exclusive upper bound so we don't rely on
    // an invalid literal like "2026-06-31".
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const sb = await createClient();
    // v_monthly_collections.month is DATE_TRUNC('month', payment_date) — a timestamp at the
    // first of the month, so match the date, not the "YYYY-MM" string.
    const { data: collections } = await sb
      .from('v_monthly_collections')
      .select('total_collected, payment_count')
      .eq('month', `${target}-01`)
      .maybeSingle();
    // Expenditures view is per-category (many rows/month); sum the base table directly instead.
    const { data: expRows } = await sb
      .from('expenditures')
      .select('amount')
      .eq('is_voided', false)
      .gte('expense_date', `${target}-01`)
      .lt('expense_date', nextMonth);
    const collected = Number((collections as Record<string, unknown> | null)?.total_collected ?? 0);
    const totalExp  = (expRows ?? []).reduce((s: number, r) => s + Number((r as Record<string, unknown>).amount), 0);
    return {
      month:         target,
      collected,
      payment_count: Number((collections as Record<string, unknown> | null)?.payment_count ?? 0),
      expenses:      totalExp,
      net:           collected - totalExp,
    };
  },
});

const searchExpensesSchema = z.object({
  month: z.string().optional()
    .describe('Single month in YYYY-MM format — the simple case ("expenses in June").'),
  from: z.string().optional()
    .describe('Start date YYYY-MM-DD for an arbitrary range ("how much did we spend on electricity this year?"). Use with `to`.'),
  to: z.string().optional()
    .describe('End date YYYY-MM-DD for an arbitrary range. Use with `from`.'),
  category: z.string().optional()
    .describe('Filter by category e.g. "ELECTRICITY". Omit to return all expenses in the period.'),
});

const searchExpenses = tool({
  description: 'Search expense records for a month or an arbitrary date range, optionally filtered by category. Use for "what did we spend on X" / "expenses this year" — anything wider than a single month.',
  inputSchema: searchExpensesSchema,
  execute: async ({ month, from, to, category }: z.infer<typeof searchExpensesSchema>) => {
    let rangeFrom: string;
    let rangeTo: string;
    if (from || to) {
      rangeFrom = from ?? '2000-01-01';
      rangeTo   = to ?? new Date().toISOString().slice(0, 10);
    } else {
      const target = month ?? new Date().toISOString().slice(0, 7);
      rangeFrom = `${target}-01`;
      rangeTo   = `${target}-31`;
    }
    const sb = await createClient();
    type ExpenseRow = { expense_date: string; category: string; amount: number; description: string | null };

    let rows: ExpenseRow[];
    try {
      rows = await fetchAll<ExpenseRow>((f, t) => {
        let q = sb
          .from('expenditures')
          .select('expense_date, category, amount, description')
          .eq('is_voided', false)
          .gte('expense_date', rangeFrom)
          .lte('expense_date', rangeTo)
          .order('expense_date', { ascending: false })
          .order('id', { ascending: false })
          .range(f, t);
        if (category) q = q.eq('category', category as ExpenseCategory);
        return q;
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    if (!rows.length) return { result: `No expenses found for ${rangeFrom} to ${rangeTo}${category ? ` (${category})` : ''}.` };
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    // Cap the listed rows for token economy — total/count above are always over the full match.
    return {
      from: rangeFrom,
      to: rangeTo,
      total: `₹${total.toLocaleString('en-IN')}`,
      count: rows.length,
      expenses: rows.slice(0, 30).map(e => ({
        date:        e.expense_date,
        category:    e.category,
        amount:      `₹${Number(e.amount).toLocaleString('en-IN')}`,
        description: e.description,
      })),
    };
  },
});

const getBalanceSummarySchema = z.object({
  from: z.string().optional().describe('Start date YYYY-MM-DD. Omit with `to` for an all-time summary.'),
  to: z.string().optional().describe('End date YYYY-MM-DD. Defaults to today.'),
});

const getBalanceSummary = tool({
  description: 'Get the cash position (opening balance, receipts, payments, closing balance) for a period — the same statement as the Balance Sheet page. Use for "what\'s our cash position", "how much did we collect and spend this quarter", or anything needing an opening/closing balance rather than just a monthly total.',
  inputSchema: getBalanceSummarySchema,
  execute: async ({ from, to }: z.infer<typeof getBalanceSummarySchema>) => {
    const rangeTo = to ?? new Date().toISOString().slice(0, 10);
    const s = await computeLeanBalanceSummary(from, rangeTo);
    return {
      from: s.from,
      to: s.to,
      opening: s.opening !== null ? `₹${s.opening.toLocaleString('en-IN')}` : 'not on record — no balance snapshot exists before this period',
      receipts: `₹${s.receipts.toLocaleString('en-IN')}`,
      payments: `₹${s.payments.toLocaleString('en-IN')}`,
      net: `₹${s.net.toLocaleString('en-IN')}`,
      closing: s.closing !== null ? `₹${s.closing.toLocaleString('en-IN')}` : 'unknown — opening balance not on record',
    };
  },
});

export const agentTools = {
  checkDues,
  lookupPaymentHistory,
  searchExpenses,
  getMonthSummary,
  getBalanceSummary,
};
