export const metadata = { title: 'Residents · Trezia' };

import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { redirect } from 'next/navigation';
import { ListSkeleton } from '@/components/ui/Skeleton';
import Card from '@/components/ui/Card';
import Link from 'next/link';
import type { DuesSummary, Resident, Unit } from '@/types/database';
import FilterBar from '@/components/ui/FilterBar';
import AddResidentButton from './AddResidentButton';
import PageHeader from '@/components/ui/PageHeader';
import UnitActions from '../units/UnitActions';
import ResidentsTableBody from './ResidentsTableBody';
import { societyPath } from '@/lib/society-path';

type ResidentsSP = Promise<{ flat?: string; occupancy?: string; active?: string }>;

export default async function ResidentsPage({ searchParams }: { searchParams: ResidentsSP }) {
  const params = await searchParams;
  return (
    <Suspense key={JSON.stringify(params)} fallback={<ListSkeleton />}>
      <ResidentsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ResidentsContent({
  searchParams,
}: {
  searchParams: ResidentsSP;
}) {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'manage_residents')) redirect('/access-denied');

  const params        = await searchParams;
  const flatFilter    = typeof params.flat === 'string' ? params.flat.trim() : '';
  const occupancyFilter = params.occupancy === 'OWNER' || params.occupancy === 'TENANT' || params.occupancy === 'VACANT' ? params.occupancy : '';
  const activeFilter    = params.active === 'active' || params.active === 'inactive' ? params.active : '';

  const supabase = await createClient();

  const [unitsResult, duesResult, configResult] = await Promise.all([
    supabase
      .from('units')
      .select('*, residents!residents_unit_same_society(id, unit_id, full_name, occupancy_type, phone, email, notification_channel, consent_given, consent_date, is_primary, move_in_date, move_out_date, is_active, notes, created_at, updated_at)')
      .eq('society_id', auth.societyId)
      .eq('is_active', true)
      .order('flat_number'),
    supabase.from('v_dues_summary').select('flat_number, total_due, unpaid_months, unpaid_levies').eq('society_id', auth.societyId),
    supabase.from('society_config').select('monthly_maintenance_amount').eq('society_id', auth.societyId).single(),
  ]);
  if (unitsResult.error || duesResult.error || configResult.error) {
    throw new Error('Resident financial data could not be loaded. Retry before relying on balances.');
  }
  const unitsRaw = unitsResult.data;
  const dues = duesResult.data;
  const config = configResult.data;

  const defaultAmount = config?.monthly_maintenance_amount ?? 0;
  const canManageUnits = hasCapability(auth.role, 'manage_units');

  const duesMap = new Map<string, DuesSummary>(
    (dues ?? []).map((d) => [d.flat_number, d as DuesSummary])
  );

  type UnitWithResidents = Unit & {
    residents: Resident[];
  };

  const units = (unitsRaw ?? []) as unknown as UnitWithResidents[];

  // Mirrors ResidentsTableBody's own primary-resident derivation, so what this
  // filter matches is exactly what the table row visibly shows.
  function primaryOf(u: UnitWithResidents) {
    const residents = Array.isArray(u.residents) ? u.residents : [];
    return residents.find(r => r.is_primary && r.is_active) ?? residents.find(r => r.is_active) ?? null;
  }

  let filtered = flatFilter
    ? units.filter(u => u.flat_number.toLowerCase().includes(flatFilter.toLowerCase()))
    : units;

  if (occupancyFilter) {
    filtered = filtered.filter(u => {
      const primary = primaryOf(u);
      return occupancyFilter === 'VACANT' ? !primary : primary?.occupancy_type === occupancyFilter;
    });
  }
  if (activeFilter) {
    filtered = filtered.filter(u => {
      const hasActive = !!primaryOf(u);
      const hasAnyResident = (Array.isArray(u.residents) ? u.residents : []).length > 0;
      return activeFilter === 'active' ? hasActive : (!hasActive && hasAnyResident);
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Residents"
        count={filtered.length}
        countLabel="units"
        action={
          <div className="flex items-center gap-2">
            {canManageUnits && <UnitActions mode="add" defaultAmount={defaultAmount} />}
            <AddResidentButton units={units.map(unit => ({ id: unit.id, flat_number: unit.flat_number }))} />
          </div>
        }
      />

      <SearchBar />

      {(flatFilter || occupancyFilter || activeFilter) && (
        <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">
          Showing <strong className="text-[var(--sf-label)]">{filtered.length}</strong> of {units.length} units
          {flatFilter && <> for <strong className="text-[var(--sf-label)]">&ldquo;{flatFilter}&rdquo;</strong></>}
          {' '}— <Link href={societyPath(auth.societySlug, '/residents')} className="text-[var(--sf-blue)] hover:underline">Clear</Link>
        </p>
      )}

      {/* flush: the table draws its own row dividers edge to edge, so Card's
          default p-6 left them stopping 24px short of the border and the table
          read as floating rather than contained. The empty state keeps its own
          padding because it is prose, not a table. */}
      <Card flush>
        {filtered.length === 0 ? (
          <p className="px-6 py-8 text-center text-[var(--text-sm)] text-sf-label2">
            {flatFilter ? `No units matching "${flatFilter}".` : 'No active units found.'}
          </p>
        ) : (
          <div className="overflow-x-auto sticky-thead">
            <table className="w-full text-[var(--text-sm)]">
              <ResidentsTableBody units={filtered} duesRecord={Object.fromEntries(duesMap)} defaultAmount={defaultAmount} canManageUnits={canManageUnits} />
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SearchBar() {
  return (
    <FilterBar
      fields={[
        { type: 'text' as const, name: 'flat', placeholder: 'Search by flat…', widthClass: 'w-48' },
        { type: 'select' as const, name: 'occupancy', placeholder: 'All occupancy', options: [
          { value: 'OWNER', label: 'Owner' },
          { value: 'TENANT', label: 'Tenant' },
          { value: 'VACANT', label: 'Vacant' },
        ] },
        { type: 'select' as const, name: 'active', placeholder: 'All residents', options: [
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Moved out' },
        ] },
      ]}
    />
  );
}
