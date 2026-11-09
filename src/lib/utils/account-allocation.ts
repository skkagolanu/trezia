export type AccountObligationKind = 'maintenance' | 'levy';

export type AccountObligation = {
  id: string;
  kind: AccountObligationKind;
  label: string;
  /** ISO date on which the charge became payable. */
  effectiveDate: string;
  outstanding: number;
};

export type AccountAllocation = {
  obligationId: string;
  kind: AccountObligationKind;
  label: string;
  applied: number;
  settlesObligation: boolean;
};

export type AccountAllocationResult = {
  allocations: AccountAllocation[];
  unapplied: number;
};

function toPaise(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 100)) : 0;
}

const KIND_ORDER: Record<AccountObligationKind, number> = { maintenance: 0, levy: 1 };

function compareObligations(left: AccountObligation, right: AccountObligation): number {
  return left.effectiveDate.localeCompare(right.effectiveDate)
    || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || left.id.localeCompare(right.id);
}

/**
 * Preview the database allocator in O(n): callers preserve the database's
 * oldest-first order within each ledger, then this performs a two-way merge.
 * Maintenance wins only when both ledgers have a charge on the same day.
 * Money is reduced as integer paise so the preview cannot drift by fractions
 * of a paise from the PostgreSQL numeric transaction.
 */
export function allocateAccount(
  obligations: readonly AccountObligation[],
  paymentAmount: number,
): AccountAllocationResult {
  let remainingPaise = toPaise(paymentAmount);
  const maintenance: AccountObligation[] = [];
  const levies: AccountObligation[] = [];
  for (const obligation of obligations) {
    if (toPaise(obligation.outstanding) === 0) continue;
    const ledger = obligation.kind === 'maintenance' ? maintenance : levies;
    const previous = ledger.at(-1);
    if (previous && compareObligations(previous, obligation) > 0) {
      throw new Error(`Account ${obligation.kind} obligations must be oldest first`);
    }
    ledger.push(obligation);
  }
  const allocations: AccountAllocation[] = [];

  let maintenanceIndex = 0;
  let levyIndex = 0;
  while (remainingPaise > 0 && (maintenanceIndex < maintenance.length || levyIndex < levies.length)) {
    const maintenanceItem = maintenance[maintenanceIndex];
    const levyItem = levies[levyIndex];
    const obligation = maintenanceItem && levyItem
      ? (compareObligations(maintenanceItem, levyItem) <= 0 ? maintenanceItem : levyItem)
      : (maintenanceItem ?? levyItem);
    if (!obligation) break;
    if (obligation.kind === 'maintenance') maintenanceIndex += 1;
    else levyIndex += 1;
    const outstandingPaise = toPaise(obligation.outstanding);
    const appliedPaise = Math.min(outstandingPaise, remainingPaise);
    allocations.push({
      obligationId: obligation.id,
      kind: obligation.kind,
      label: obligation.label,
      applied: appliedPaise / 100,
      settlesObligation: appliedPaise === outstandingPaise,
    });
    remainingPaise -= appliedPaise;
  }

  return { allocations, unapplied: remainingPaise / 100 };
}
