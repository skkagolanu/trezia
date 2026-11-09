import { hasCapability, type Capability } from '@/lib/auth/roles';
import type { AppRole } from '@/types/database';

// composes an EXISTING exception source; the attention tab itself writes
// nothing and only links to the correction workflow that owns the fix.
export type AttentionCategoryKey =
  | 'pending_claims'
  | 'gateway_reconciliation'
  | 'unmatched_bank_lines'
  | 'missing_current_bills'
  | 'contract_renewals'
  | 'stale_backups';

export interface AttentionCategoryDef {
  key: AttentionCategoryKey;
  label: string;
  description: string;
  // Existing capability that already gates the underlying source. Finance and
  // operations items are visible to Admin and Treasurer; backup/configuration
  // items require manage_backups, which only Admin holds — this is exactly the
  // "Admin sees backup items; Admin and Treasurer see finance/operations items"
  // rule, implemented through the existing capability matrix rather than a new one.
  capability: Capability;
  // Correction workflow this category links into. Passed through societyPath at
  // render time so the slug is preserved.
  href: string;
}

export const ATTENTION_CATEGORIES: readonly AttentionCategoryDef[] = [
  {
    key: 'pending_claims',
    label: 'Payment submissions to review',
    description: 'Residents uploaded payment proof awaiting your approval.',
    capability: 'finance_read',
    href: '/claims',
  },
  {
    key: 'gateway_reconciliation',
    label: 'Gateway payments to reconcile',
    description: 'Online money confirmed against already-settled bills — review for refund or credit.',
    capability: 'finance_read',
    href: '/payments',
  },
  {
    key: 'unmatched_bank_lines',
    label: 'Unmatched bank lines',
    description: 'Imported statement rows not yet matched to a recorded transaction.',
    capability: 'finance_read',
    href: '/bank-reconciliation',
  },
  {
    key: 'missing_current_bills',
    label: "Flats missing this month's bill",
    description: 'Active flats with no bill issued for the current billing month.',
    capability: 'finance_read',
    href: '/bills',
  },
  {
    key: 'contract_renewals',
    label: 'Contract renewals due',
    description: 'Vendor contracts inside their renewal-notice window or already past their end date.',
    capability: 'operations_read',
    href: '/operations',
  },
  {
    key: 'stale_backups',
    label: 'Backup health',
    description: 'The most recent scheduled backup failed or is older than expected.',
    capability: 'manage_backups',
    href: '/settings',
  },
];

export function attentionCategory(key: AttentionCategoryKey): AttentionCategoryDef {
  const def = ATTENTION_CATEGORIES.find(c => c.key === key);
  if (!def) throw new Error(`Unknown attention category: ${key}`);
  return def;
}

// Which categories a role may see. A missing/unknown role sees none.
export function visibleAttentionCategories(role: AppRole | null | undefined): AttentionCategoryDef[] {
  return ATTENTION_CATEGORIES.filter(def => hasCapability(role, def.capability));
}

export function isAttentionCategoryVisible(role: AppRole | null | undefined, key: AttentionCategoryKey): boolean {
  return visibleAttentionCategories(role).some(def => def.key === key);
}

// A society's daily backup is expected roughly every 24h. Treat the newest
// snapshot as stale when the last attempt FAILED, when none exists, or when the
// last success is older than `staleDays`. Pure so the boundary is unit-tested.
export function isBackupStale(
  lastSnapshotAt: string | null,
  lastResult: string | null,
  asOf: Date,
  staleDays = 2,
): boolean {
  if (lastResult === 'FAILED') return true;
  if (!lastSnapshotAt) return true;
  const age = asOf.getTime() - new Date(lastSnapshotAt).getTime();
  if (Number.isNaN(age)) return true;
  return age > staleDays * 24 * 60 * 60 * 1000;
}

export interface AttentionCount {
  key: AttentionCategoryKey;
  // null means the source query failed and the count is unknown — the tab must
  // surface this rather than silently reporting zero.
  count: number | null;
}

// Total open items across the categories a role can see. A failed source
// (count null) is excluded from the sum but flagged separately so the summary
// never understates by treating an error as zero.
export function summarizeAttention(counts: AttentionCount[]): { total: number; hasFailure: boolean } {
  let total = 0;
  let hasFailure = false;
  for (const item of counts) {
    if (item.count === null) hasFailure = true;
    else total += item.count;
  }
  return { total, hasFailure };
}

export function isContractRenewalDue(
  endDate: string | null,
  renewalNoticeDays: number,
  asOf: string,
): boolean {
  if (!endDate) return false;
  if (endDate <= asOf) return true;
  const noticeDate = new Date(`${endDate}T00:00:00Z`);
  noticeDate.setUTCDate(noticeDate.getUTCDate() - Math.max(0, renewalNoticeDays));
  return noticeDate.toISOString().slice(0, 10) <= asOf;
}
