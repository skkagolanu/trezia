import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { redirect } from 'next/navigation';

export default async function GenerateBillsLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_write')) redirect('/access-denied');
  return <>{children}</>;
}
