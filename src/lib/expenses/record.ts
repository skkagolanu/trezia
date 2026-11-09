import { createClient } from '@/lib/supabase/server';
import type { ExpenseCategory } from '@/types/database';

export interface RecordExpenseInput {
  category:     ExpenseCategory;
  amount:       number;
  description:  string;
  expense_date: string;
}

export type RecordExpenseResult =
  | { expense: { id: string }; error?: never }
  | { expense?: never; error: string };

export async function recordExpenseLogic(input: RecordExpenseInput): Promise<RecordExpenseResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('expenditures')
    .insert({
      category:     input.category,
      amount:       input.amount,
      description:  input.description,
      expense_date: input.expense_date,
    })
    .select('id')
    .single();

  if (error) return { error: error.message };
  return { expense: data };
}
