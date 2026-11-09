export const metadata = { title: 'Export · Trezia' };

import ExportForm from './ExportForm';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';

export default async function ExportPage() {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'export_audit')) redirect('/access-denied');

  return (
    <div className="space-y-4">
      <PageHeader title="Export & Backup" subtitle="Download working CSVs; Administrators can also generate the versioned offboarding manifest." />
        <ExportForm canManageBackups={hasCapability(auth.role, 'manage_backups')} />
    </div>
  );
}
