import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { hasCapability, type AppRole } from '@/lib/auth/roles';
import Card from '@/components/ui/Card';
import { computeSetupItems, type SetupConfigSnapshot } from './setup-items';
import SetupChecklistPanel from './SetupChecklistPanel';

interface Props {
  role: AppRole;
  societyId: string | null;
  societySlug: string | null;
  isDemo: boolean;
}

/**
 * First-run setup nudge rendered once, in the shared app layout, for the
 * roles that can actually act on it. Silent (renders null) for Residents,
 * for a fully-configured society, and once dismissed — a nag that never goes
 * away is worse than no nag.
 */
export default async function SetupChecklist({ role, societyId, societySlug, isDemo }: Props) {
  // Demo is a canned, fully-configured fixture society (see src/lib/demo/data.ts)
  // meant to show the polished experience — it has no real onboarding gap to
  // surface, so it's excluded up front rather than relying on its config
  // happening to compute to zero items.
  if (isDemo || !societyId || !hasCapability(role, 'manage_financial_setup')) return null;

  const supabase = await createClient();
  const [{ data: config, error: configError }, { count: activeUnitCount, error: unitsError }] = await Promise.all([
    supabase
      .from('society_config')
      .select('monthly_maintenance_amount, maintenance_payment_window_days, upi_id, upi_qr_object_key')
      .eq('society_id', societyId)
      .maybeSingle(),
    supabase
      .from('units')
      .select('id', { count: 'exact', head: true })
      .eq('society_id', societyId)
      .eq('is_active', true)
      .eq('is_test_unit', false),
  ]);

  // A failed lookup must not be interpreted as missing configuration or flats:
  // that would send an operator to fix work we have not actually established
  // is outstanding.
  if (configError || unitsError) {
    return (
      <Card title="Setup status unavailable" className="mb-6">
        <p className="text-[var(--text-sm)] text-[var(--sf-label3)]">
          We couldn&apos;t check your society setup. Refresh the page to try again.
        </p>
      </Card>
    );
  }

  const items = computeSetupItems(
    config as SetupConfigSnapshot | null,
    activeUnitCount ?? 0,
    societySlug,
    hasCapability(role, 'manage_units'),
  );
  if (items.length === 0) return null;

  const cookieName = `tz_setup_dismissed_${societyId}`;
  const cookieStore = await cookies();
  if (cookieStore.get(cookieName)?.value === '1') return null;

  return <SetupChecklistPanel items={items} cookieName={cookieName} />;
}
