import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import ExpenseForm from '@/components/forms/ExpenseForm';

export const metadata = { title: 'Add Expense · Trezia' };

export default async function NewExpensePage() {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_write')) redirect('/access-denied');
  return (
    <div className="max-w-xl mx-auto">
      <PageHeader title="Add Expense" />
      <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)]">
        <ExpenseForm />
      </div>
    </div>
  );
}
