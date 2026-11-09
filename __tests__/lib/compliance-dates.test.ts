import { getComplianceReminder } from '@/lib/utils/compliance-dates';

describe('getComplianceReminder', () => {
  it('returns null outside the Apr-Sep window', () => {
    expect(getComplianceReminder(new Date(2026, 2, 31))).toBeNull(); // 31 Mar
    expect(getComplianceReminder(new Date(2026, 9, 1))).toBeNull();  // 1 Oct
  });

  it('shows the FY that just ended, not overdue, in April', () => {
    const r = getComplianceReminder(new Date(2026, 3, 5));
    expect(r).not.toBeNull();
    expect(r!.fyLabel).toBe('FY 2025–26');
    expect(r!.auditOverdue).toBe(false);
    expect(r!.agmOverdue).toBe(false);
  });

  it('flags audit overdue after 31 July but AGM not yet due', () => {
    const r = getComplianceReminder(new Date(2026, 7, 1)); // 1 Aug
    expect(r!.auditOverdue).toBe(true);
    expect(r!.agmOverdue).toBe(false);
  });

  it('flags both overdue after 30 September boundary within window', () => {
    const r = getComplianceReminder(new Date(2026, 8, 30)); // 30 Sep, still in window (month <= 8)
    expect(r!.auditOverdue).toBe(true);
    expect(r!.agmOverdue).toBe(false); // exactly on the deadline, not past it
  });
});
