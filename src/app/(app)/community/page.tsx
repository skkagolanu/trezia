export const metadata = { title: 'Community · Trezia' };

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { redirect } from 'next/navigation';
import { formatINR } from '@/lib/utils/currency';
import PageHeader from '@/components/ui/PageHeader';

export default async function CommunityPage() {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_community_dues');

  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader title="Community Dues" />
        <p className="text-[var(--text-sm)] text-[var(--sf-red)]">Failed to load community data. Please refresh.</p>
      </div>
    );
  }

  const flatData = ((data ?? []) as Array<{ flat_number: string; total_due: number }>).map(row => ({
    flat_number: row.flat_number,
    total_due: Number(row.total_due),
  }));

  const withDues    = flatData.filter(f => f.total_due > 0);
  const fullyPaid   = flatData.filter(f => f.total_due === 0);
  const totalDue    = flatData.reduce((s, f) => s + f.total_due, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Community Dues"
        subtitle={`${withDues.length} flat${withDues.length !== 1 ? 's' : ''} with dues · ${fullyPaid.length} fully paid`}
      />

      {flatData.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-8 text-center">
          <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">No flats to show</p>
          <p className="mx-auto mt-1 max-w-md text-[var(--text-xs)] text-[var(--sf-label2)]">
            Your society has no active flats available in the community view. Please contact the society administrator if this looks incorrect.
          </p>
        </div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-3">
              <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">Total flats</p>
              <p className="text-[var(--text-md)] font-bold text-[var(--sf-label)] tabular">{flatData.length}</p>
            </div>
            <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-3">
              <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">Fully paid</p>
              <p className="text-[var(--text-md)] font-bold text-[var(--sf-green)] tabular">{fullyPaid.length}</p>
            </div>
            <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-3">
              <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">Total outstanding</p>
              <p className="text-[var(--text-md)] font-bold text-[var(--sf-red)] tabular">{formatINR(totalDue)}</p>
            </div>
          </div>

          {/* Flat grid */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {flatData.map(f => (
              <div
                key={f.flat_number}
                className={[
                  'rounded-[var(--radius-md)] border p-3',
                  f.total_due > 0
                    ? 'border-[color-mix(in_srgb,var(--sf-red)_20%,transparent)] bg-[color-mix(in_srgb,var(--sf-red)_4%,var(--sf-surface))]'
                    : 'border-[color-mix(in_srgb,var(--sf-green)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-green)_4%,var(--sf-surface))]',
                ].join(' ')}
              >
                <p className="break-words text-[var(--text-sm)] font-bold text-[var(--sf-label)]">{f.flat_number}</p>
                {f.total_due > 0 ? (
                  <p className="text-[var(--text-xs)] font-semibold text-[var(--sf-red)] tabular mt-0.5">{formatINR(f.total_due)}</p>
                ) : (
                  <p className="text-[var(--text-xs)] text-[var(--sf-green)] mt-0.5">✓ Paid</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
