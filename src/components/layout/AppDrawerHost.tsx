'use client';
import { lazy, startTransition, Suspense } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Drawer from '@/components/ui/Drawer';
import { useDrawer } from '@/lib/context/DrawerContext';
import { currentSocietySlug, societyPath } from '@/lib/society-path';

function FormSkeleton() {
  return (
    <div className="p-5 space-y-5">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="space-y-2" style={{ animationDelay: `${i * 50}ms` }}>
          <div className="h-3 w-20 rounded-md bg-[color-mix(in_srgb,var(--sf-label2)_15%,transparent)] animate-pulse" />
          <div className="h-9 w-full rounded-[10px] bg-[color-mix(in_srgb,var(--sf-label2)_9%,transparent)] animate-pulse" />
        </div>
      ))}
      <div className="h-9 w-full rounded-[10px] bg-[color-mix(in_srgb,var(--sf-blue)_15%,transparent)] animate-pulse mt-2" />
    </div>
  );
}

const PaymentForm = lazy(() => import('@/components/forms/PaymentForm'));
const ExpenseForm = lazy(() => import('@/components/forms/ExpenseForm'));

export default function AppDrawerHost() {
  const router = useRouter();
  const pathname = usePathname();
  const societySlug = currentSocietySlug(pathname);
  const { activeRoute, closeDrawer } = useDrawer();

  const isPayment = activeRoute === '/payments/new';
  const isExpense = activeRoute === '/expenses/new';

  function handlePaymentSuccess(result: { type: 'maintenance' | 'levy' | 'other-income'; flatNumber?: string }) {
    closeDrawer();
    if (result.type === 'other-income') {
      router.push(societyPath(societySlug, '/payments/other-income?period=all'));
      startTransition(() => router.refresh());
      return;
    }
    const params = new URLSearchParams({ type: 'all', period: 'all' });
    if (result.flatNumber) params.set('flat', result.flatNumber);
    router.push(societyPath(societySlug, `/payments?${params}`));
    // The destination can already be the active payments route. Refresh its
    // server payload explicitly so the new receipt and reduced flat balance do
    // not remain hidden behind the client router cache.
    startTransition(() => router.refresh());
  }

  function handleExpenseSuccess() {
    closeDrawer();
    startTransition(() => router.refresh());
  }

  return (
    <>
      <Drawer
        open={isPayment}
        onClose={closeDrawer}
        title="Record Payment"
        width={500}
      >
        {isPayment && (
          <Suspense fallback={<FormSkeleton />}>
            <PaymentForm onSuccess={handlePaymentSuccess} onCancel={closeDrawer} />
          </Suspense>
        )}
      </Drawer>

      <Drawer
        open={isExpense}
        onClose={closeDrawer}
        title="Record Expense"
        width={500}
      >
        {isExpense && (
          <Suspense fallback={<FormSkeleton />}>
            <ExpenseForm onSuccess={handleExpenseSuccess} />
          </Suspense>
        )}
      </Drawer>
    </>
  );
}
