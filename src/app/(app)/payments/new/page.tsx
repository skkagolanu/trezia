import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import PaymentForm from '@/components/forms/PaymentForm';

export const metadata = { title: 'Record Payment · Trezia' };

export default async function NewPaymentPage() {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_write')) redirect('/access-denied');
  return (
    <div className="max-w-xl mx-auto">
      <PageHeader title="Record Payment" />
      <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)]">
        <PaymentForm />
      </div>
    </div>
  );
}
