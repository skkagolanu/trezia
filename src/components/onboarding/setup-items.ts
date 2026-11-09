// Pure computation of the first-run setup checklist shown to Admins and
// Treasurers on an under-configured society. Kept free of Supabase/Next
// imports so the item logic is trivially unit-testable — SetupChecklist.tsx
// does the fetching and hands the raw config/count in here.
import { societyPath } from '@/lib/society-path';

export type SetupItemSeverity = 'blocking' | 'recommended';

export interface SetupItem {
  id: 'billing_config' | 'active_units' | 'upi_payment';
  title: string;
  body: string;
  href?: string;
  actionLabel?: string;
  severity: SetupItemSeverity;
}

// Only the four society_config columns the checklist actually reads. Both
// billing columns are NOT NULL with defaults once a row exists (see migration
// 002/043) — the only way either reads as null/undefined is that no
// society_config row exists yet at all, which is exactly the state a society
// that never finished setup is in.
export interface SetupConfigSnapshot {
  monthly_maintenance_amount: number | null | undefined;
  maintenance_payment_window_days: number | null | undefined;
  upi_id: string | null | undefined;
  upi_qr_object_key: string | null | undefined;
}

/**
 * Builds the ordered list of setup steps still outstanding for a society.
 * Returns an empty array once nothing is left to do — callers must render
 * nothing at all in that case rather than an empty card.
 */
export function computeSetupItems(
  config: SetupConfigSnapshot | null,
  activeUnitCount: number,
  societySlug: string | null,
  canManageUnits: boolean,
): SetupItem[] {
  const items: SetupItem[] = [];

  // src/app/api/bills/route.ts refuses bulk bill generation with a 422 unless
  // both of these are set — a society literally cannot bill without them.
  if (
    config == null
    || config.monthly_maintenance_amount == null
    || config.maintenance_payment_window_days == null
  ) {
    items.push({
      id: 'billing_config',
      title: 'Set your maintenance amount and billing window',
      body: 'Bills cannot be generated until the monthly maintenance amount and the payment window are set.',
      href: societyPath(societySlug, '/settings'),
      severity: 'blocking',
    });
  }

  // Same route filters units on is_active/is_test_unit before billing — zero
  // active, non-test units means there is nothing to bill.
  if (activeUnitCount === 0) {
    items.push({
      id: 'active_units',
      title: canManageUnits ? 'Add at least one flat' : 'An Admin must add at least one flat',
      body: canManageUnits
        ? 'A society with no active flats has nothing to bill or collect from.'
        : 'Financial setup is available, but only an Admin can create or reactivate flat master data.',
      href: canManageUnits ? societyPath(societySlug, '/residents') : undefined,
      actionLabel: canManageUnits ? 'Fix now' : 'Admin action required',
      severity: 'blocking',
    });
  }

  // Not a hard blocker — a resident without this can still pay by bank
  // transfer/cash (the printed bank details) or on Razorpay if it's
  // configured. But it gates the free UPI pay link and QR panel on My Flat,
  // so it's worth surfacing as a recommended (not blocking) step.
  if (!config?.upi_id && !config?.upi_qr_object_key) {
    items.push({
      id: 'upi_payment',
      title: 'Set up a UPI ID or payment QR',
      body: 'Without this, residents only see bank-transfer details — the free UPI pay button and QR stay hidden on My Flat.',
      href: societyPath(societySlug, '/settings'),
      severity: 'recommended',
    });
  }

  return items;
}
