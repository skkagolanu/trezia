import { redirect } from 'next/navigation';
import { requireAuth, type AuthResult } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';

// Every route under /payments (the hub itself and its levies/bills/other-income/
// attention sub-routes) gates on the same finance_read capability and needs the
// same non-nullable auth shape (societyId/societySlug for scoped links and
// queries). Centralised so five route entry points can't drift on the check.
export type PaymentsAuth = Extract<AuthResult, { unauthorized: null }>;

export async function requirePaymentsAuth(): Promise<PaymentsAuth> {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_read')) redirect('/access-denied');
  return auth;
}
