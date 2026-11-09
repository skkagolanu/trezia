import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/fetch-all';

export interface BalanceSummary {
  from: string;
  to: string;
  opening: number | null;
  receipts: number;
  payments: number;
  net: number;
  closing: number | null;
}

/** Scoped cash-position summary: opening balance, receipts, payments and closing balance. */
export async function computeLeanBalanceSummary(from: string | undefined, to: string): Promise<BalanceSummary> {
  const sb = await createClient();

  // Anchor the opening balance on the latest snapshot before `from` — a single
  // indexed row lookup, not a full-table scan.
  let anchorDate = '2000-01-01';
  let anchorTotal = 0;
  let anchorFound = false;
  if (from) {
    const { data: anchor } = await sb
      .from('balance_snapshots')
      .select('snapshot_date, bank_balance, cash_in_hand')
      .lt('snapshot_date', from)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (anchor) {
      anchorDate = anchor.snapshot_date;
      anchorTotal = Number(anchor.bank_balance ?? 0) + Number(anchor.cash_in_hand ?? 0);
      anchorFound = true;
    }
  }


  const rangeFrom = from ? anchorDate : '2000-01-01';
  type AmountRow = { amount_paid?: number; amount?: number };
  const [maint, levies, income, expenses] = await Promise.all([
    fetchAll<AmountRow>((f, t) =>
      sb.from('payments').select('amount_paid, units!payments_unit_same_society!inner(is_test_unit)').eq('is_voided', false)
        .eq('units.is_test_unit', false)
        .gte('payment_date', rangeFrom).lte('payment_date', to)
        .order('id').range(f, t),
    ),
    fetchAll<AmountRow>((f, t) =>
      sb.from('amc_collections').select('amount_paid, units!amc_unit_same_society!inner(is_test_unit)').eq('is_voided', false)
        .eq('units.is_test_unit', false)
        .gte('payment_date', rangeFrom).lte('payment_date', to)
        .order('id').range(f, t),
    ),
    fetchAll<AmountRow>((f, t) =>
      sb.from('other_income').select('amount').eq('is_voided', false)
        .gte('income_date', rangeFrom).lte('income_date', to)
        .order('id').range(f, t),
    ),
    fetchAll<AmountRow>((f, t) =>
      sb.from('expenditures').select('amount').eq('is_voided', false)
        .gte('expense_date', rangeFrom).lte('expense_date', to)
        .order('id').range(f, t),
    ),
  ]);

  const sum = (rows: AmountRow[], key: 'amount_paid' | 'amount') =>
    rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

  const receipts = sum(maint, 'amount_paid') + sum(levies, 'amount_paid') + sum(income, 'amount');
  const payments = sum(expenses, 'amount');

  const openingKnown = !from || anchorFound;
  const opening = from ? (openingKnown ? anchorTotal : null) : null;
  const closing = opening !== null ? opening + receipts - payments : null;

  return { from: from ?? 'start of records', to, opening, receipts, payments, net: receipts - payments, closing };
}
