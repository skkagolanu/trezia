const MONTH_MAP: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4,  May: 5,  Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

export function parseMonthsDetail(
  detail: string | null | undefined
): Array<{ year: number; month: number; label: string }> {
  if (!detail) return [];
  return detail.split(',').flatMap(part => {
    const label = part.trim();
    const [abbr, yearStr] = label.split(' ');
    const month = MONTH_MAP[abbr];
    const year = parseInt(yearStr, 10);
    if (!month || isNaN(year)) return [];
    return [{ year, month, label }];
  });
}

export type PaymentMonthRecord = {
  id: string;
  unit_id: string;
  months_detail: string | null;
  receipt_number: string | null;
  payment_date: string;
  amount_paid: number;
  flat_number?: string;
};

export type PaymentMonthOverlap = {
  unitId: string;
  flatNumber: string;
  year: number;
  month: number;
  label: string;
  payments: PaymentMonthRecord[];
};

/** Group active payment records that claim the same flat and maintenance month. */
export function findPaymentMonthOverlaps(
  payments: PaymentMonthRecord[],
): PaymentMonthOverlap[] {
  const groups = new Map<string, {
    unitId: string;
    flatNumber: string;
    year: number;
    month: number;
    label: string;
    payments: PaymentMonthRecord[];
  }>();

  for (const payment of payments) {
    const seenInPayment = new Set<string>();
    for (const period of parseMonthsDetail(payment.months_detail)) {
      const periodKey = `${period.year}-${period.month}`;
      if (seenInPayment.has(periodKey)) continue;
      seenInPayment.add(periodKey);

      const key = `${payment.unit_id}:${periodKey}`;
      const group = groups.get(key) ?? {
        unitId: payment.unit_id,
        flatNumber: payment.flat_number ?? payment.unit_id,
        year: period.year,
        month: period.month,
        label: period.label,
        payments: [],
      };
      group.payments.push(payment);
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .filter(group => group.payments.length > 1)
    .sort((a, b) =>
      a.flatNumber.localeCompare(b.flatNumber, undefined, { numeric: true })
      || a.year - b.year
      || a.month - b.month,
    );
}
