import { format } from 'date-fns';

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return format(d, 'dd MMM yyyy');
}

export function formatMonthYear(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return format(d, 'MMM yyyy');
}

export function currentFinancialYear(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    start: new Date(year, 3, 1),
    end:   new Date(year + 1, 2, 31),
    label: `FY ${year}-${(year + 1).toString().slice(2)}`,
  };
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function nowTime(): string {
  return format(new Date(), 'HH:mm');
}

