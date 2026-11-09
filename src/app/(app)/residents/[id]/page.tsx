export const metadata = { title: 'Flat · Trezia' };

import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils/date';
import { formatINR } from '@/lib/utils/currency';
import type { OccupancyType, NotificationChannel, AmcCollection, LevyAssessment } from '@/types/database';
import Link from 'next/link';
import EditResidentButton from './EditResidentButton';
import AddResidentButton from '../AddResidentButton';
import MoveOutButton from './MoveOutButton';
import PaymentHistoryTable from './PaymentHistoryTable';
import { UnitActiveToggle } from './UnitActiveToggle';
import { outstandingLevy } from '@/lib/utils/levies';
import { societyApiPath, societyPath } from '@/lib/society-path';
import PageHeader from '@/components/ui/PageHeader';
import { labelDisplay } from '@/lib/utils/levy-label';

function occupancyColor(type: OccupancyType): 'blue' | 'green' | 'gray' {
  if (type === 'OWNER') return 'blue';
  if (type === 'TENANT') return 'green';
  return 'gray';
}

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'manage_residents')) redirect('/access-denied');

  const { id } = await params;

  const supabase = await createClient();
  const societySlug = (await headers()).get('x-society-slug');

  const [unitResult, residentsResult, paymentsResult, leviesResult, levyConfigsResult] = await Promise.all([
      supabase.from('units').select('*').eq('id', id).eq('society_id', auth.societyId).maybeSingle(),
      supabase
        .from('residents')
        .select('*')
        .eq('society_id', auth.societyId)
        .eq('unit_id', id)
        .order('is_primary', { ascending: false })
        .order('move_in_date', { ascending: false }),
      supabase
        .from('payments')
        .select('id, amount_paid, payment_mode, payment_date, receipt_number, months_covered, months_detail, payment_status, is_voided')
        .eq('society_id', auth.societyId)
        .eq('unit_id', id)
        .eq('is_voided', false)
        .order('payment_date', { ascending: false }),
      supabase
        .from('amc_collections')
        .select('id, unit_id, resident_id, levy_label, amount_paid, payment_date, payment_mode, notes, pdf_url, recorded_by, is_voided, void_reason, voided_at, created_at')
        .eq('society_id', auth.societyId)
        .eq('unit_id', id)
        .eq('is_voided', false),
      supabase
        .from('levy_assessments')
        .select('id, unit_id, levy_label, amount, amount_settled, status, is_voided, created_at, updated_at, society_id, void_reason, voided_at')
        .eq('society_id', auth.societyId)
        .eq('unit_id', id)
        .eq('is_voided', false)
        .order('created_at'),
    ]);
  if (
    unitResult.error || residentsResult.error || paymentsResult.error
    || leviesResult.error || levyConfigsResult.error
  ) {
    throw new Error('Resident account data could not be loaded. Retry before relying on balances or history.');
  }
  const unit = unitResult.data;
  const residents = residentsResult.data;
  const payments = paymentsResult.data;
  const leviesRaw = leviesResult.data;
  const levyConfigs = levyConfigsResult.data;

  const levies = (leviesRaw ?? []) as AmcCollection[];
  const allLevies = (levyConfigs ?? []) as LevyAssessment[];
  const history = [
    ...(payments ?? []).map(payment => ({ ...payment, kind: 'maintenance' as const })),
    ...levies.map(levy => ({
      id: levy.id,
      kind: 'levy' as const,
      amount_paid: levy.amount_paid,
      payment_mode: levy.payment_mode,
      payment_date: levy.payment_date ?? '',
      receipt_number: null,
      months_covered: 1,
      months_detail: labelDisplay(levy.levy_label),
      payment_status: 'PAID',
      is_voided: levy.is_voided,
    })),
  ];

  if (!unit) notFound();

  const { data: duesRow, error: duesError } = await supabase
    .from('v_dues_summary')
    .select('*')
    .eq('society_id', auth.societyId)
    .eq('flat_number', unit.flat_number)
    .maybeSingle();
  if (duesError) {
    throw new Error('Resident dues could not be loaded. Retry before relying on the account total.');
  }

  const primaryResident = (residents ?? []).find((r) => r.is_primary && r.is_active);

  return (
    <div className="flex flex-col">
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-[var(--text-sm)] text-[var(--sf-label3)]">
        <Link href={societyPath(societySlug, '/residents')} className="hover:text-[var(--sf-blue)] transition-colors">Residents</Link>
        <span>/</span>
        <span className="text-[var(--sf-label)]">Flat {unit.flat_number}</span>
      </nav>
      <PageHeader
        title={`Flat ${unit.flat_number}`}
        subtitle={primaryResident?.full_name ?? 'No primary resident'}
        action={(
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <UnitActiveToggle unitId={unit.id} isActive={unit.is_active} />
            <AddResidentButton unitId={unit.id} />
          </div>
        )}
      />

      <div className="flex-1 space-y-6 p-6">
        {unit.is_test_unit && (
          <div className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sf-blue)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-blue)_6%,transparent)] px-4 py-3 text-[var(--text-sm)] text-[var(--sf-blue)]">
            <strong>Test unit</strong> — payments and bills recorded here are excluded from all dues lists, collection totals, and reports. Safe to use for testing any feature.
          </div>
        )}
        {!unit.is_active && !unit.is_test_unit && (
          <div className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sf-orange)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-orange)_8%,transparent)] px-4 py-3 text-[var(--text-sm)] text-[var(--sf-orange)]">
            This unit is <strong>inactive</strong> — excluded from bill generation, dues calculations, and all reports.
            Use the toggle above to activate it temporarily for testing.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <InfoCard label="Flat Number" value={unit.flat_number} />
          <InfoCard label="Area (sq ft)" value={unit.flat_area_sqft?.toString() ?? '—'} />
          <InfoCard
            label="Monthly Amount"
            value={unit.monthly_amount != null ? formatINR(unit.monthly_amount) : '—'}
          />
        </div>

        {duesRow && (
          <Card title="Dues Summary">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <InfoCard
                label="Total Due"
                value={formatINR(duesRow.total_due ?? 0)}
                accent={(duesRow.total_due ?? 0) > 0 ? 'red' : 'green'}
              />
              <InfoCard label="Unpaid Months" value={String(duesRow.unpaid_months ?? 0)} />
              <InfoCard
                label="Balance Breakdown"
                value={`${formatINR(duesRow.maintenance_due ?? 0)} maintenance · ${formatINR(duesRow.levy_due ?? 0)} AMC`}
              />
              <InfoCard
                label="Last Paid"
                value={duesRow.last_paid_date ? formatDate(duesRow.last_paid_date) : '—'}
              />
            </div>
            {(duesRow.total_due ?? 0) > 0 && (
              <div className="mt-4 flex justify-end">
                <a
                  href={societyApiPath(`/s/${societySlug ?? ''}`, `/api/pdf/dues-notice?flat=${encodeURIComponent(unit.flat_number)}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-sf-blue/[0.4] bg-sf-blue/[0.06] px-3 py-1.5 text-[13px] font-medium text-sf-blue hover:bg-sf-blue/[0.12] transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  Dues Notice
                </a>
              </div>
            )}
          </Card>
        )}

        <Card title="AMC">
          {allLevies.length === 0 ? (
            <p className="py-4 text-center text-[14px] text-sf-label3">No AMC has been raised for this flat.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {allLevies.map(levy => {
                const total = Number(levy.amount_settled);
                const status = levy.status === 'PAID' ? 'paid' : total > 0 ? 'partial' : 'pending';
                return (
                  <div
                    key={levy.id}
                    className={`min-w-0 rounded-xl border p-3 ${status === 'paid' ? 'border-sf-green/30 bg-sf-green/[0.06]' : status === 'partial' ? 'border-sf-orange/30 bg-sf-orange/[0.06]' : 'border-sf-red/20 bg-sf-red/[0.04]'}`}
                  >
                    <p className="break-words text-[11px] font-semibold text-sf-label3">{labelDisplay(levy.levy_label)}</p>
                    {status !== 'pending' ? (
                      <>
                        <p className={`mt-1 text-[15px] font-bold ${status === 'paid' ? 'text-sf-green' : 'text-sf-orange'}`}>{formatINR(total)}</p>
                        <p className="text-[11px] text-sf-label3">{status === 'paid' ? 'Paid' : `Partial · ${formatINR(outstandingLevy(levy))} due`}</p>
                      </>
                    ) : (
                      <>
                        <p className="mt-1 text-[15px] font-bold text-sf-red">Unpaid</p>
                        <p className="text-[11px] text-sf-label3">Expected {formatINR(Number(levy.amount))}</p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Residents">
          {(residents ?? []).length === 0 ? (
            <p className="py-4 text-center text-[14px] text-sf-label3">No residents recorded.</p>
          ) : (
            <div className="space-y-3">
              {(residents ?? []).map((r) => (
                <div
                  key={r.id}
                  className={`rounded-[10px] border p-4 ${r.is_primary ? 'border-sf-blue/[0.25] bg-sf-blue/[0.04]' : 'border-black/[0.07] bg-sf-surface'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 break-words">
                      <span className="font-semibold text-sf-label">{r.full_name}</span>
                      {r.is_primary && (
                        <Badge color="blue" className="ml-2">Primary</Badge>
                      )}
                      {!r.is_active && (
                        <Badge color="gray" className="ml-2">Inactive</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color={occupancyColor(r.occupancy_type as OccupancyType)}>
                        {r.occupancy_type}
                      </Badge>
                      <EditResidentButton resident={r} unitId={unit.id} />
                      {r.is_active && <MoveOutButton resident={r} />}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
                    <ResidentField label="Phone">
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} className="text-sf-blue hover:underline">
                          {r.phone}
                        </a>
                      ) : '—'}
                    </ResidentField>
                    <ResidentField label="Email">{r.email ?? '—'}</ResidentField>
                    <ResidentField label="Notification">
                      <Badge color={r.notification_channel === 'NONE' ? 'gray' : 'blue'}>
                        {r.notification_channel as NotificationChannel}
                      </Badge>
                    </ResidentField>
                    <ResidentField label="Move-in">
                      {r.move_in_date ? formatDate(r.move_in_date) : '—'}
                    </ResidentField>
                    {r.move_out_date && (
                      <ResidentField label="Move-out">{formatDate(r.move_out_date)}</ResidentField>
                    )}
                    <ResidentField label="Consent">
                      <Badge color={r.consent_given ? 'green' : 'gray'}>
                        {r.consent_given ? 'Given' : 'Not given'}
                      </Badge>
                    </ResidentField>
                  </div>

                  {r.notes && (
                    <p className="mt-2 break-words text-[13px] text-sf-label3">{r.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Payment History">
          {history.length === 0 ? (
            <p className="py-4 text-center text-[14px] text-sf-label3">No payments recorded.</p>
          ) : (
            <PaymentHistoryTable payments={history} />
          )}
        </Card>
      </div>
    </div>
  );
}

function InfoCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'red' | 'green';
}) {
  const valueClass =
    accent === 'red'   ? 'text-sf-red font-semibold' :
    accent === 'green' ? 'text-sf-green font-semibold' :
    'text-sf-label font-medium';

  return (
    <div className="rounded-[10px] border border-black/[0.07] bg-sf-bg p-3">
      <p className="text-[12px] text-sf-label3">{label}</p>
      <p className={`mt-0.5 text-[14px] ${valueClass}`}>{value}</p>
    </div>
  );
}

function ResidentField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className="text-[12px] text-sf-label3">{label}: </span>
      <span className="break-words text-sf-label2">{children}</span>
    </div>
  );
}
