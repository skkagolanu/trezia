import { redirect } from 'next/navigation';
import { societyPath } from '@/lib/society-path';
import { requireAuth } from '@/lib/supabase/require-auth';

export async function redirectToSociety(path: string): Promise<never> {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  redirect(societyPath(auth.societySlug, path));
}
