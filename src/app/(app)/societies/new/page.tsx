export const metadata = { title: 'Create Society · Trezia' };

import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { requirePlatformOwner } from '@/lib/supabase/require-auth';
import CreateSocietyWizard from './CreateSocietyWizard';
import { multiSocietyRoutingEnabled, platformCreationEnabled } from '@/lib/features';

export default async function NewSocietyPage() {
  if (!multiSocietyRoutingEnabled() || !platformCreationEnabled()) redirect('/access-denied');
  const auth = await requirePlatformOwner();
  if (auth.unauthorized) redirect('/access-denied');
  return <div className="space-y-5"><PageHeader title="Create Society" /><CreateSocietyWizard /></div>;
}
