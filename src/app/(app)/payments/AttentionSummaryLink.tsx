import Link from 'next/link';
import { societyPath } from '@/lib/society-path';
import { loadAttentionCounts } from './AttentionView';
import type { AppRole } from '@/types/database';

// Shown only on the default /payments view — every other tab already has its
// own focus, and the full worklist now lives at its own route (/payments/attention).
export default async function AttentionSummaryLink({
  societyId,
  societySlug,
  role,
}: {
  societyId: string;
  societySlug: string | null;
  role: AppRole;
}) {
  const attention = await loadAttentionCounts(societyId, societySlug, role);
  if (attention.total === 0 && !attention.hasFailure) return null;

  return (
    <Link
      href={societyPath(societySlug, '/payments/attention')}
      className="flex items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-sf-orange/30 bg-sf-orange/[0.08] px-4 py-3 no-underline"
    >
      <span className="text-[13px] font-semibold text-sf-label">
        {attention.hasFailure
          ? `${attention.total}+ item${attention.total === 1 ? '' : 's'} need attention — some checks could not be loaded`
          : `${attention.total} item${attention.total === 1 ? '' : 's'} need attention`}
      </span>
      <span className="shrink-0 text-[12px] font-medium text-sf-orange">Review →</span>
    </Link>
  );
}
