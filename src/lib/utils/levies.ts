export type LevyStatus = 'pending' | 'partial' | 'paid';

export interface LevyCollectionLike {
  id: string;
  unit_id: string;
  amount_paid: number;
  payment_date?: string | null;
  created_at?: string;
  is_voided?: boolean;
}

// Migration 067. The per-unit obligation row (src/types/database.ts
// LevyAssessment) — trimmed to the fields status derivation actually needs, so
// a caller can pass a real row straight through without reshaping it.
export interface LevyAssessmentLike {
  unit_id: string;
  amount: number;
  amount_settled: number;
  status: 'PENDING' | 'PAID';
  is_voided?: boolean;
}

/**
 * What a levy assessment still owes. Mirrors outstandingAmount() for bills:
 * clamped at zero so an over-settled assessment cannot show a negative balance
 * or hand a negative amount to the payment form, and rounded to paise so the
 * figure a resident sees is the figure that gets submitted.
 */
export function outstandingLevy(
  assessment: { amount: number | string; amount_settled: number | string },
): number {
  const remaining = Number(assessment.amount) - Number(assessment.amount_settled);
  return remaining > 0 ? Math.round(remaining * 100) / 100 : 0;
}

export interface LevySummary<T extends LevyCollectionLike> {
  total: number;
  status: LevyStatus;
  latest: T | null;
  collections: T[];
}

/**
 * Aggregate active levy rows without losing the individual records.
 *
 * `assessmentsByUnit` is optional and additive (migration 067): when a unit
 * has a real levy_assessments row, its stored status/amount_settled is
 * authoritative — an assessment records a per-flat amount and a partial
 * settlement directly, which the collections-vs-one-shared-default derivation
 * below cannot express. Units with no assessment (a levy never raised through
 * raise_levy_assessment, or a caller that omits the map entirely) keep
 * exactly today's derived behaviour, so every existing call site continues to
 * work unchanged.
 */
export function aggregateLevyCollections<T extends LevyCollectionLike>(
  collections: T[],
  expectedAmount: number,
  assessmentsByUnit?: Map<string, LevyAssessmentLike> | null,
): Map<string, LevySummary<T>> {
  const grouped = new Map<string, T[]>();
  for (const collection of collections) {
    if (collection.is_voided) continue;
    const rows = grouped.get(collection.unit_id) ?? [];
    rows.push(collection);
    grouped.set(collection.unit_id, rows);
  }

  // Units known only through an assessment (no collection recorded yet, e.g.
  // a freshly raised levy nobody has paid) must still surface a summary —
  // otherwise a resident's brand-new PENDING assessment would be invisible.
  const unitIds = new Set<string>([...grouped.keys(), ...(assessmentsByUnit?.keys() ?? [])]);

  const result = new Map<string, LevySummary<T>>();
  for (const unitId of unitIds) {
    const rows = grouped.get(unitId) ?? [];
    const sorted = [...rows].sort((a, b) =>
      (b.payment_date ?? '').localeCompare(a.payment_date ?? '') ||
      (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    const total = sorted.reduce((sum, row) => sum + Number(row.amount_paid), 0);
    const status = levyStatusFor(total, expectedAmount, assessmentsByUnit?.get(unitId));
    result.set(unitId, { total, status, latest: sorted[0] ?? null, collections: sorted });
  }
  return result;
}

/**
 * `assessment` is optional and trailing (migration 067) so every existing
 * 2-argument call site keeps its current derived behaviour unchanged. When a
 * real, non-voided assessment is passed, its own status/amount_settled
 * decide the answer directly instead of comparing a summed total against one
 * shared default amount.
 */
export function levyStatusFor(
  total: number,
  expectedAmount: number,
  assessment?: LevyAssessmentLike | null,
): LevyStatus {
  if (assessment && !assessment.is_voided) {
    if (assessment.status === 'PAID') return 'paid';
    return Number(assessment.amount_settled) > 0 ? 'partial' : 'pending';
  }
  if (total <= 0) return 'pending';
  return expectedAmount > 0 && total < expectedAmount ? 'partial' : 'paid';
}
