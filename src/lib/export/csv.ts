function escapeCsv(value: string | number | boolean | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(escapeCsv).join(',');
}

export interface PaymentExportRow {
  receipt_number: string | null;
  flat_number: string;
  resident_name: string;
  payment_date: string;
  payment_time: string | null;
  amount_paid: number;
  payment_mode: string;
  months_covered: number;
  months_detail: string | null;
  utr_reference: string | null;
  collector_name: string | null;
  notes: string | null;
  is_voided: boolean;
  void_reason: string | null;
  created_at: string;
  row_hash: string | null;
}

export function paymentsToCSV(rows: PaymentExportRow[]): string {
  const header = row([
    'receipt_number', 'flat_number', 'resident_name', 'payment_date', 'payment_time',
    'amount_paid', 'payment_mode', 'months_covered', 'months_detail', 'utr_reference',
    'collector_name', 'notes', 'is_voided', 'void_reason', 'created_at', 'row_hash',
  ]);
  const lines = rows.map(r => row([
    r.receipt_number,
    r.flat_number,
    r.resident_name,
    r.payment_date,
    r.payment_time,
    r.amount_paid,
    r.payment_mode,
    r.months_covered,
    r.months_detail,
    r.utr_reference,
    r.collector_name,
    r.notes,
    r.is_voided,
    r.void_reason,
    r.created_at,
    r.row_hash,
  ]));
  return [header, ...lines].join('\n');
}

export interface ExpenseExportRow {
  expense_date: string;
  category: string;
  description: string;
  amount: number;
  paid_via: string | null;
  payee_name: string | null;
  reference_number: string | null;
  notes: string | null;
  is_voided: boolean;
  void_reason: string | null;
  created_at: string;
}

export function expensesToCSV(rows: ExpenseExportRow[]): string {
  const header = row([
    'expense_date', 'category', 'description', 'amount', 'paid_via', 'payee_name',
    'reference_number', 'notes', 'is_voided', 'void_reason', 'created_at',
  ]);
  const lines = rows.map(r => row([
    r.expense_date, r.category, r.description, r.amount, r.paid_via,
    r.payee_name, r.reference_number, r.notes, r.is_voided, r.void_reason, r.created_at,
  ]));
  return [header, ...lines].join('\n');
}

export interface DuesExportRow {
  flat_number: string;
  resident_name: string | null;
  phone: string | null;
  email: string | null;
  unpaid_months: number;
  total_due: number;
  last_paid_date: string | null;
}

export function duesToCSV(rows: DuesExportRow[]): string {
  const header = row([
    'flat_number', 'resident_name', 'phone', 'email',
    'unpaid_months', 'total_due', 'last_paid_date',
  ]);
  const lines = rows.map(r => row([
    r.flat_number, r.resident_name, r.phone, r.email,
    r.unpaid_months, r.total_due, r.last_paid_date,
  ]));
  return [header, ...lines].join('\n');
}

export function downloadFilename(prefix: string, ext = 'csv'): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}_${stamp}.${ext}`;
}
