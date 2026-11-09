export const metadata = { title: 'Societies · Trezia' };

import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { listUserSocieties } from '@/lib/supabase/require-auth';
import SocietiesDashboard from './SocietiesDashboard';
import { roleHome } from '@/lib/auth/roles';
import { multiSocietyRoutingEnabled } from '@/lib/features';

export default async function SocietiesPage() {
  if (!multiSocietyRoutingEnabled()) redirect('/payments');
  const context = await listUserSocieties();
  if (!context) redirect('/login');
  if (!context.isPlatformOwner && context.societies.length === 1) {
    const society = context.societies[0];
    redirect(`/s/${society.slug}${roleHome(society.role)}`);
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Societies" />
      <SocietiesDashboard isPlatformOwner={context.isPlatformOwner} />
    </div>
  );
}
