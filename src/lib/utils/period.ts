import { format } from 'date-fns';

export type PeriodKey = 'month' | 'lastMonth' | 'quarter' | 'fy' | 'all' | 'custom';

/** FY quarter number: Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar. */
export type Quarter = 1 | 2 | 3 | 4;

export interface ResolvedPeriod {
  key: PeriodKey;
  /** Inclusive ISO date (YYYY-MM-DD). Undefined = unbounded. */
  from?: string;
  /** Inclusive ISO date (YYYY-MM-DD). Undefined = unbounded. */
  to?: string;
  label: string;
}

/** First financial year with data on record (data starts Feb 2022). */
export const FIRST_FY = 2022;

const pad = (n: number) => String(n).padStart(2, '0');

/** FY runs April→March: Jan–Mar belong to the FY that started the previous April. */
export function fyStartYearOf(d: Date): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

export function fyLabel(fyStartYear: number): string {
  return `FY ${fyStartYear}–${String(fyStartYear + 1).slice(2)}`;
}

export function fyRange(fyStartYear: number): { from: string; to: string } {
  return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const lastDay = new Date(year, month, 0).getDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` };
}

/** The calendar month before `now`, crossing the year boundary in January. */
export function lastMonthRange(now: Date = new Date()): { from: string; to: string; year: number; month: number } {
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 12 : now.getMonth(); // getMonth() is 0-indexed, so this is already "last month"
  return { ...monthRange(y, m), year: y, month: m };
}

/** First calendar month of a given FY quarter (Q1=Apr..Q4=Jan), and its year. */
function quarterStartMonth(fyStartYear: number, quarter: Quarter): { year: number; month: number } {
  const starts: Record<Quarter, { year: number; month: number }> = {
    1: { year: fyStartYear,     month: 4 },
    2: { year: fyStartYear,     month: 7 },
    3: { year: fyStartYear,     month: 10 },
    4: { year: fyStartYear + 1, month: 1 },
  };
  return starts[quarter];
}

export function quarterRange(fyStartYear: number, quarter: Quarter): { from: string; to: string } {
  const start = quarterStartMonth(fyStartYear, quarter);
  const endMonthOffset = quarter === 4 ? 3 : start.month + 2;
  const end = quarter === 4 ? { year: start.year, month: 3 } : { year: start.year, month: endMonthOffset };
  return { from: monthRange(start.year, start.month).from, to: monthRange(end.year, end.month).to };
}

export function quarterLabel(fyStartYear: number, quarter: Quarter): string {
  return `Q${quarter} ${fyLabel(fyStartYear)}`;
}

/** The four quarters, in order. Labels don't depend on the FY — Q1..Q4 always. */
export function quarterOptions(): Array<{ value: Quarter; label: string }> {
  return [1, 2, 3, 4].map(q => ({ value: q as Quarter, label: `Q${q}` }));
}

/** All selectable FYs, FIRST_FY through the FY containing `now`, ascending. */
export function fyOptions(now: Date = new Date()): Array<{ value: string; label: string }> {
  const current = fyStartYearOf(now);
  return Array.from({ length: current - FIRST_FY + 1 }, (_, i) => {
    const y = FIRST_FY + i;
    return { value: String(y), label: fyLabel(y) };
  });
}

function customLabel(from?: string, to?: string): string {
  const f = (iso: string) => format(new Date(iso + 'T12:00:00'), 'dd MMM yyyy');
  if (from && to) return `${f(from)} – ${f(to)}`;
  if (from) return `From ${f(from)}`;
  if (to) return `Until ${f(to)}`;
  return 'Custom range';
}

const PERIOD_KEYS: readonly PeriodKey[] = ['month', 'lastMonth', 'quarter', 'fy', 'all', 'custom'];

function isPeriodKey(v: string | undefined): v is PeriodKey {
  return !!v && (PERIOD_KEYS as readonly string[]).includes(v);
}


export function resolvePeriod(
  params: { period?: string; from?: string; to?: string; fy?: string; q?: string },
  opts: { defaultKey?: PeriodKey; now?: Date } = {},
): ResolvedPeriod {
  const now = opts.now ?? new Date();
  const key: PeriodKey = isPeriodKey(params.period) ? params.period : (opts.defaultKey ?? 'month');

  if (key === 'month') {
    const r = monthRange(now.getFullYear(), now.getMonth() + 1);
    return { key, ...r, label: format(now, 'MMMM yyyy') };
  }
  if (key === 'lastMonth') {
    const { from, to, year, month } = lastMonthRange(now);
    return { key, from, to, label: format(new Date(year, month - 1, 1), 'MMMM yyyy') };
  }
  if (key === 'fy') {
    const parsed = params.fy ? parseInt(params.fy, 10) : NaN;
    const y = Number.isNaN(parsed) ? fyStartYearOf(now) : parsed;
    return { key, ...fyRange(y), label: fyLabel(y) };
  }
  if (key === 'quarter') {
    const parsedFy = params.fy ? parseInt(params.fy, 10) : NaN;
    const y = Number.isNaN(parsedFy) ? fyStartYearOf(now) : parsedFy;
    const parsedQ = params.q ? parseInt(params.q, 10) : NaN;
    const q: Quarter = (parsedQ >= 1 && parsedQ <= 4 ? parsedQ : Math.floor(((now.getMonth() + 9) % 12) / 3) + 1) as Quarter;
    return { key, ...quarterRange(y, q), label: quarterLabel(y, q) };
  }
  if (key === 'all') {
    return { key, label: 'All Time' };
  }
  const from = params.from || undefined;
  const to = params.to || undefined;
  return { key, from, to, label: customLabel(from, to) };
}
