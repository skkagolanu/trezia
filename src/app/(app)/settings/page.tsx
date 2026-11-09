export const metadata = { title: 'Settings · Trezia' };

import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { requireAuth } from '@/lib/supabase/require-auth';
import { redirect } from 'next/navigation';
import SettingsForm from './SettingsForm';
import FinancialSetupForm from './FinancialSetupForm';
import SnapshotsCard from './SnapshotsCard';
import LevyConfigsCard from './LevyConfigsCard';
import UpiQrCard from './UpiQrCard';
import TreasurersCard, { type FyTreasurer, type ResidentOption } from './TreasurersCard';
import AccessManagementCard, { type AccessResidentOption } from './AccessManagementCard';
import TreasurerAccountsCard from './TreasurerAccountsCard';
import PendingRequestsCard from './PendingRequestsCard';
import CommitteeEmailCard from './CommitteeEmailCard';
import SecurityCard from './SecurityCard';
import Link from 'next/link';
import type { SocietyConfig, LevyConfig } from '@/types/database';
import { hasCapability } from '@/lib/auth/roles';
import { societyPath } from '@/lib/society-path';

export default async function SettingsPage() {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'finance_read')) redirect('/access-denied');
  const isAdmin = hasCapability(auth.role, 'manage_config');
  const canManageFinancialSetup = hasCapability(auth.role, 'manage_financial_setup');

  const supabase = await createClient();

  const financialResults = canManageFinancialSetup ? await Promise.all([
    supabase.from('society_config').select('*').eq('society_id', auth.societyId).single(),
    supabase.from('levy_configs').select('id, levy_label, default_amount, created_at, is_active_for_new_collections').eq('society_id', auth.societyId).eq('is_active_for_new_collections', true).order('created_at'),
  ]) : null;
  const adminResults = isAdmin ? await Promise.all([
    supabase.from('units').select('id, flat_number').eq('society_id', auth.societyId).eq('is_active', true).order('flat_number'),
    supabase.from('resident_invites').select('id, email, role, unit_id, created_at, claimed_at').eq('society_id', auth.societyId).is('revoked_at', null).order('created_at', { ascending: false }),
    supabase.from('fy_treasurers').select('fy_start_year, resident_id').eq('society_id', auth.societyId),
    supabase.from('residents').select('id, full_name, unit_id, occupancy_type, email, phone, is_primary').eq('society_id', auth.societyId).eq('is_active', true).order('full_name'),
  ]) : null;
  const config = financialResults?.[0].data ?? null;
  const levyConfigs = financialResults?.[1].data ?? [];
  const units = adminResults?.[0].data ?? [];
  const invitesRaw = adminResults?.[1].data ?? [];
  const inviteLoadError = adminResults?.[1].error
    ? 'Authorized accounts could not be loaded. Refresh the page or check the deployment logs.'
    : null;
  const fyTreasurers = adminResults?.[2].data ?? [];
  const residents = adminResults?.[3].data ?? [];
  const settingsLoadError = Boolean(financialResults?.some(result => Boolean(result.error)))
    || Boolean(adminResults?.some(result => Boolean(result.error)));

  // Join flat_number onto each invite
  const unitMap = new Map((units ?? []).map(u => [u.id, u.flat_number]));

  // Treasurer picker options: "flat — name", so a flat visibly anchors the name.
  const residentOptions: ResidentOption[] = (residents ?? []).map(r => {
    const flat = r.unit_id ? unitMap.get(r.unit_id) : null;
    return { id: r.id, label: flat ? `${flat} — ${r.full_name}` : r.full_name };
  });
  const invites = (invitesRaw ?? []).map(inv => ({
    ...inv,
    flat_number: inv.unit_id ? (unitMap.get(inv.unit_id) ?? null) : null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      {canManageFinancialSetup && settingsLoadError ? <div role="alert" className="rounded-2xl border border-sf-red/20 bg-sf-red/[0.05] p-5 text-[14px] text-sf-red">Settings could not be loaded safely. Refresh the page before making changes.</div> : canManageFinancialSetup ? <>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
          <div data-society-write className="contents">
            {isAdmin
              ? <SettingsForm config={config as SocietyConfig | null} societyId={auth.societyId} />
              : <FinancialSetupForm config={config as SocietyConfig | null} />}
          </div>
          <div className="space-y-6">
            {isAdmin && <div data-society-write className="contents"><TreasurersCard treasurers={fyTreasurers as FyTreasurer[]} residents={residentOptions} /></div>}
            <div data-society-write className="contents"><LevyConfigsCard configs={levyConfigs as LevyConfig[]} /></div>
            <div data-society-write className="contents"><UpiQrCard hasQr={Boolean((config as SocietyConfig | null)?.upi_qr_object_key)} /></div>
            {isAdmin && <SnapshotsCard />}
            {isAdmin && <div data-society-write className="contents"><CommitteeEmailCard /></div>}
            <SecurityCard />
          </div>
        </div>
        {isAdmin && <div data-society-write className="contents"><PendingRequestsCard /></div>}
        {isAdmin && <div data-society-write className="contents">
        <AccessManagementCard
          invites={invites.filter(inv => inv.role === 'resident')}
          units={units as { id: string; flat_number: string }[]}
          residents={residents as AccessResidentOption[]}
          loadError={inviteLoadError}
        />
        </div>}
        {isAdmin && <div data-society-write className="contents"><TreasurerAccountsCard invites={invites.filter(inv => inv.role === 'treasurer')} loadError={inviteLoadError} /></div>}
      </> : <SecurityCard />}

      {/* Advanced — full width below */}
      <div className="rounded-2xl border border-black/[0.07] bg-sf-surface">
        <div className="border-b border-black/[0.06] px-6 py-4">
          <h3 className="text-[15px] font-semibold text-sf-label">Advanced</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-6">
          {isAdmin && (
            <Link href={societyPath(auth.societySlug, '/import')} className="flex items-center justify-between rounded-[10px] border border-black/[0.07] bg-sf-bg px-4 py-3 hover:bg-black/[0.03] transition-colors">
              <div>
                <p className="text-[14px] font-medium text-sf-label">Import Existing Data</p>
                <p className="text-[12px] text-sf-label3">Rebuild the books from CSV, stage by stage</p>
              </div>
              <span className="text-sf-label3 text-[18px]">›</span>
            </Link>
          )}
          <Link href={societyPath(auth.societySlug, '/export')} className="flex items-center justify-between rounded-[10px] border border-black/[0.07] bg-sf-bg px-4 py-3 hover:bg-black/[0.03] transition-colors">
            <div>
              <p className="text-[14px] font-medium text-sf-label">Export Data</p>
              <p className="text-[12px] text-sf-label3">Download payments or expenses as CSV / Excel</p>
            </div>
            <span className="text-sf-label3 text-[18px]">›</span>
          </Link>
          <Link href={societyPath(auth.societySlug, '/audit')} className="flex items-center justify-between rounded-[10px] border border-black/[0.07] bg-sf-bg px-4 py-3 hover:bg-black/[0.03] transition-colors">
            <div>
              <p className="text-[14px] font-medium text-sf-label">Audit Log</p>
              <p className="text-[12px] text-sf-label3">View all changes made to the system</p>
            </div>
            <span className="text-sf-label3 text-[18px]">›</span>
          </Link>
          <Link href={societyPath(auth.societySlug, '/balance-snapshots')} className="flex items-center justify-between rounded-[10px] border border-black/[0.07] bg-sf-bg px-4 py-3 hover:bg-black/[0.03] transition-colors">
            <div>
              <p className="text-[14px] font-medium text-sf-label">Balance Snapshots</p>
              <p className="text-[12px] text-sf-label3">Record and review cash/bank balance checkpoints</p>
            </div>
            <span className="text-sf-label3 text-[18px]">›</span>
          </Link>
          <Link href={societyPath(auth.societySlug, '/handovers')} className="flex items-center justify-between rounded-[10px] border border-black/[0.07] bg-sf-bg px-4 py-3 hover:bg-black/[0.03] transition-colors">
            <div>
              <p className="text-[14px] font-medium text-sf-label">Treasurer Handovers</p>
              <p className="text-[12px] text-sf-label3">View handover records and balance transfers</p>
            </div>
            <span className="text-sf-label3 text-[18px]">›</span>
          </Link>
          <Link href={societyPath(auth.societySlug, '/opening-balances')} className="flex items-center justify-between rounded-[10px] border border-black/[0.07] bg-sf-bg px-4 py-3 hover:bg-black/[0.03] transition-colors">
            <div>
              <p className="text-[14px] font-medium text-sf-label">Opening Balances</p>
              <p className="text-[12px] text-sf-label3">Record an authoritative opening balance per financial year</p>
            </div>
            <span className="text-sf-label3 text-[18px]">›</span>
          </Link>
          <Link href={societyPath(auth.societySlug, '/fund-ledger')} className="flex items-center justify-between rounded-[10px] border border-black/[0.07] bg-sf-bg px-4 py-3 hover:bg-black/[0.03] transition-colors">
            <div>
              <p className="text-[14px] font-medium text-sf-label">Fund Ledger</p>
              <p className="text-[12px] text-sf-label3">Corpus and Sinking Fund as tracked ledgers</p>
            </div>
            <span className="text-sf-label3 text-[18px]">›</span>
          </Link>
          <Link href={societyPath(auth.societySlug, '/advances')} className="flex items-center justify-between rounded-[10px] border border-black/[0.07] bg-sf-bg px-4 py-3 hover:bg-black/[0.03] transition-colors">
            <div>
              <p className="text-[14px] font-medium text-sf-label">Advances Ledger</p>
              <p className="text-[12px] text-sf-label3">Track ADVANCE payments and expenses to settlement</p>
            </div>
            <span className="text-sf-label3 text-[18px]">›</span>
          </Link>
          <Link href={societyPath(auth.societySlug, '/bank-reconciliation')} className="flex items-center justify-between rounded-[10px] border border-black/[0.07] bg-sf-bg px-4 py-3 hover:bg-black/[0.03] transition-colors">
            <div>
              <p className="text-[14px] font-medium text-sf-label">Bank Reconciliation</p>
              <p className="text-[12px] text-sf-label3">Import a bank statement and match transactions</p>
            </div>
            <span className="text-sf-label3 text-[18px]">›</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
