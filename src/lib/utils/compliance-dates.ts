import { fyLabel, fyStartYearOf } from './period';

export interface ComplianceReminder {
  fyLabel: string;
  auditDueLabel: string;
  agmDueLabel: string;
  auditOverdue: boolean;
  agmOverdue: boolean;
}

/**
 * books audited by 31 July, AGM by 30 September, both for the FY that just
 * ended on 31 March. Only relevant Apr 1 – Sep 30 — the window between an FY
 * closing and its AGM deadline; outside that window there's nothing due.
 * Pure and date-injectable so it's unit-testable without mocking the clock.
 */
export function getComplianceReminder(now: Date): ComplianceReminder | null {
  const month = now.getMonth(); // 0-indexed: 3 = Apr, 8 = Sep
  if (month < 3 || month > 8) return null;

  const closedFyStart = now.getFullYear() - 1; // the FY that ended this 31 March
  const auditDue = new Date(now.getFullYear(), 6, 31); // 31 July
  const agmDue = new Date(now.getFullYear(), 8, 30); // 30 September

  return {
    fyLabel: fyLabel(closedFyStart),
    auditDueLabel: '31 July',
    agmDueLabel: '30 September',
    auditOverdue: now > auditDue,
    agmOverdue: now > agmDue,
  };
}

// Re-exported so callers don't need a second import for the FY the reminder refers to.
export { fyStartYearOf };
