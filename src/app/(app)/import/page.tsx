export const metadata = { title: 'Import data · Trezia' };

import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ImportWizard from './ImportWizard';

// matching the rest of society configuration.
export default async function ImportPage() {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'manage_config')) redirect('/access-denied');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Import existing data"
        subtitle="Rebuild an existing society's books stage by stage from CSV. Each stage is checked before anything is saved, and financial stages take a safety backup first."
      />
      <ImportWizard />
    </div>
  );
}
