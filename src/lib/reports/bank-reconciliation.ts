import type { SupabaseClient } from '@supabase/supabase-js';
import { findCandidateMatches, type MatchCandidate } from '@/lib/utils/bank-reconciliation';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { labelDisplay } from '@/lib/utils/levy-label';

const MATCH_WINDOW_DAYS = 3;

type PaymentCandidateRow = { id: string; payment_date: string; amount_paid: number; units: { flat_number: string } | Array<{ flat_number: string }> | null };
type LevyCandidateRow = { id: string; payment_date: string | null; amount_paid: number; levy_label: string };
type IncomeCandidateRow = { id: string; income_date: string; amount: number; description: string };
type ExpenseCandidateRow = { id: string; expense_date: string; amount: number; description: string };

// Shared between the bank-reconciliation API route and the worklist page —
// one query shape, not two copies that could drift.
export async function loadBatchWithCandidates(
  supabase: SupabaseClient<any>, // eslint-disable-line @typescript-eslint/no-explicit-any -- shared helper accepts the generated Supabase client across table query shapes
  batchId: string,
  options: { page?: number; limit?: number } = {},
) {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const offset = (page - 1) * limit;
  const [{ data: batch, error: batchError }, { data: linesRaw, error: linesError, count: lineCount }] = await Promise.all([
    supabase.from('bank_statement_batches').select('*').eq('id', batchId).single(),
    supabase.from('bank_statement_lines').select('*', { count: 'exact' }).eq('batch_id', batchId)
      .order('line_date', { ascending: true }).order('id', { ascending: true }).range(offset, offset + limit - 1),
  ]);

  if (batchError || !batch) return null;
  if (linesError) throw new Error(linesError.message);

  const lines = linesRaw ?? [];

  const from = new Date(batch.statement_from as string);
  from.setDate(from.getDate() - MATCH_WINDOW_DAYS);
  const to = new Date(batch.statement_to as string);
  to.setDate(to.getDate() + MATCH_WINDOW_DAYS);
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);

  const [payments, levies, income, expenses] = await Promise.all([
    fetchAll<PaymentCandidateRow>((rangeFrom, rangeTo) => supabase.from('payments').select('id, payment_date, amount_paid, units!payments_unit_same_society(flat_number)')
      .eq('is_voided', false).gte('payment_date', fromIso).lte('payment_date', toIso)
      .order('payment_date').order('id').range(rangeFrom, rangeTo)),
    fetchAll<LevyCandidateRow>((rangeFrom, rangeTo) => supabase.from('amc_collections').select('id, payment_date, amount_paid, levy_label')
      .eq('is_voided', false).gte('payment_date', fromIso).lte('payment_date', toIso)
      .order('payment_date').order('id').range(rangeFrom, rangeTo)),
    fetchAll<IncomeCandidateRow>((rangeFrom, rangeTo) => supabase.from('other_income').select('id, income_date, amount, description')
      .eq('is_voided', false).gte('income_date', fromIso).lte('income_date', toIso)
      .order('income_date').order('id').range(rangeFrom, rangeTo)),
    fetchAll<ExpenseCandidateRow>((rangeFrom, rangeTo) => supabase.from('expenditures').select('id, expense_date, amount, description')
      .eq('is_voided', false).gte('expense_date', fromIso).lte('expense_date', toIso)
      .order('expense_date').order('id').range(rangeFrom, rangeTo)),
  ]);

  const candidates: MatchCandidate[] = [
    ...payments.map(p => ({
      table: 'payments' as const, id: p.id as string, date: p.payment_date as string, amount: Number(p.amount_paid),
      label: `Payment — Flat ${(Array.isArray(p.units) ? p.units[0]?.flat_number : p.units?.flat_number) ?? '—'}`,
    })),
    ...levies.filter(a => a.payment_date).map(a => ({
      table: 'amc_collections' as const, id: a.id as string, date: a.payment_date as string, amount: Number(a.amount_paid),
      label: `AMC — ${labelDisplay(a.levy_label)}`,
    })),
    ...income.map(o => ({
      table: 'other_income' as const, id: o.id as string, date: o.income_date as string, amount: Number(o.amount),
      label: `Other income — ${o.description}`,
    })),
    ...expenses.map(e => ({
      table: 'expenditures' as const, id: e.id as string, date: e.expense_date as string, amount: Number(e.amount),
      label: `Expense — ${e.description}`,
    })),
  ];

  type BankLine = { id: string; line_date: string; description: string; amount: number; matched_id: string | null; is_ignored: boolean };
  const linesWithCandidates = (lines as BankLine[]).map(line => ({
    ...line,
    candidates: line.matched_id || line.is_ignored
      ? []
      : findCandidateMatches({ date: line.line_date, description: line.description, amount: Number(line.amount) }, candidates, MATCH_WINDOW_DAYS),
  }));

  const total = lineCount ?? 0;
  return { batch, lines: linesWithCandidates, pagination: { page, limit, total, hasMore: offset + linesWithCandidates.length < total } };
}
