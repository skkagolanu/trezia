export type RenewalStatus = 'OVERDUE' | 'UPCOMING';
export type RenewalItem<T> = T & { due_date: string; due_status: RenewalStatus };

export function classifyRenewals<T extends { id: string }>(
  rows: T[],
  dateOf: (row: T) => string | null,
  asOf: string,
  limit = 100,
): Array<RenewalItem<T>> {
  return rows.flatMap(row => {
    const dueDate = dateOf(row);
    return dueDate ? [{ ...row, due_date: dueDate, due_status: dueDate < asOf ? 'OVERDUE' as const : 'UPCOMING' as const }] : [];
  }).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id)).slice(0, limit);
}
