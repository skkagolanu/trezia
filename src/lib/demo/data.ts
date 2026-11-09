/* Synthetic accounting fixtures for the read-only demo. */

const SOCIETY_ID = 'demo-society';

const NAMES = [
  'Demo Resident 01','Demo Resident 02','Demo Resident 03','Demo Resident 04','Demo Resident 05',
  'Demo Resident 06','Demo Resident 07','Demo Resident 08','Demo Resident 09','Demo Resident 10','Demo Resident 11',
  'Demo Resident 12','Demo Resident 13','Demo Resident 14','Demo Resident 15','Demo Resident 16',
  'Demo Resident 17','Demo Resident 18','Demo Resident 19','Demo Resident 20','Demo Resident 21','Demo Resident 22',
  'Demo Resident 23','Demo Resident 24','Demo Resident 25','Demo Resident 26','Demo Resident 27',
  'Demo Resident 28','Demo Resident 29','Demo Resident 30','Demo Resident 31','Demo Resident 32','Demo Resident 33',
  'Demo Resident 34','Demo Resident 35','Demo Resident 36','Demo Resident 37','Demo Resident 38',
  'Demo Resident 39','Demo Resident 40','Demo Resident 41','Demo Resident 42','Demo Resident 43','Demo Resident 44',
  'Demo Resident 45','Demo Resident 46','Demo Resident 47','Demo Resident 48',
  'Demo Resident 49','Demo Resident 50','Demo Resident 51','Demo Resident 52',
  'Demo Resident 53','Demo Resident 54','Demo Resident 55',
];

const FLAT_NUMBERS: number[] = [];
for (const floor of [1, 2, 3, 4, 5])
  for (let u = 1; u <= 11; u++) FLAT_NUMBERS.push(floor * 100 + u);

const pad2 = (n: number) => String(n).padStart(2, '0');
const pad4 = (n: number) => String(n).padStart(4, '0');
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthDetailLabel = (year: number, month: number) => `${MONTH_NAMES[month - 1]} ${year}`;

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextMonthDate(year: number, month: number, day: number): string {
  const y = month === 12 ? year + 1 : year;
  const m = month === 12 ? 1 : month + 1;
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

/** FY treasurer accountable for a transaction's own accounting date (FY = Apr–Mar). */
function recordedByFor(dateIso: string): string {
  const [y, m] = dateIso.split('-').map(Number);
  const fy = m >= 4 ? y : y - 1;
  return fy >= 2026 ? 'Demo Resident 01' : fy >= 2025 ? 'Demo Resident 02' : 'Demo Resident 03';
}

// ── units (with embedded residents for join queries) ─────────────────────────
export const units = FLAT_NUMBERS.map((flat, i) => {
  const flatNumber = String(flat);
  return {
    id: `u${flat}`,
    society_id: SOCIETY_ID,
    flat_number: flatNumber,
    flat_area_sqft: 1200,
    monthly_amount: 2000,
    notes: null,
    is_active: true,
    is_test_unit: false,
    created_at: '2022-01-01T00:00:00Z',
    updated_at: '2022-01-01T00:00:00Z',
    residents: [{
      id: `r${flat}`,
      society_id: SOCIETY_ID,
      unit_id: `u${flat}`,
      full_name: NAMES[i],
      occupancy_type: i % 9 === 0 ? 'TENANT' : 'OWNER',
      phone: null,
      email: null,
      notification_channel: 'NONE',
      consent_given: false,
      consent_date: null,
      is_primary: true,
      move_in_date: '2021-06-01',
      move_out_date: null,
      is_active: true,
      notes: null,
      created_at: '2022-01-01T00:00:00Z',
      updated_at: '2022-01-01T00:00:00Z',
    }],
  };
});

// ── residents (flat table for direct resident queries) ───────────────────────
export const residents = units.flatMap(u => u.residents);

const unitByFlat = (flat: string) => units.find(u => u.flat_number === flat)!;

// ── bills — current FY only (Apr–Jul 2026; "today" is 20 Jul 2026) ───────────
// Group A (101–311, 33 flats): always PAID
// Group B (401–407,  7 flats): PAID through Jun, ISSUED (not yet due) for Jul
// Group C (408–411,  4 flats): PAID through Jun, OVERDUE for Jul
// Group D (501–511, 11 flats): OVERDUE every month — the chronic defaulters
// Bills are intentionally scoped to ONE financial year: the mock query builder
// ignores `.or(...)` filters, so bills spanning multiple FYs would leak into
// every FY's dues matrix and double-count outstanding totals.
const CURRENT_MONTH = 7;
const BILL_MONTHS = [4, 5, 6, 7];

function flatStatus(flat: number, month: number): 'PAID' | 'ISSUED' | 'OVERDUE' {
  if (flat <= 311) return 'PAID';
  if (flat <= 407) return month === CURRENT_MONTH ? 'ISSUED' : 'PAID';
  if (flat <= 411) return month === CURRENT_MONTH ? 'OVERDUE' : 'PAID';
  return 'OVERDUE';
}

function payMode(flat: number): string {
  return ['UPI','UPI','UPI','CASH','CHEQUE','BANK_TRANSFER'][flat % 6];
}

const PAY_DATES: Record<number, string[]> = {
  4: ['2026-04-03','2026-04-07','2026-04-12','2026-04-15','2026-04-20','2026-04-25'],
  5: ['2026-05-02','2026-05-06','2026-05-10','2026-05-15','2026-05-21','2026-05-27'],
  6: ['2026-06-02','2026-06-05','2026-06-09','2026-06-12','2026-06-16','2026-06-20'],
  7: ['2026-07-02','2026-07-05','2026-07-08','2026-07-12','2026-07-16','2026-07-19'],
};

export const bills = units.flatMap(({ id: unit_id, flat_number, residents: unitResidents }) => {
  const flat = parseInt(flat_number);
  return BILL_MONTHS.map(month => {
    const invoiceDate = `2026-${pad2(month)}-01`;
    return {
      id: `b${flat_number}-${month}`,
      society_id: SOCIETY_ID,
      unit_id,
      bill_period_year: 2026,
      bill_period_month: month,
      invoice_number: `INV-${flat_number}-2026${pad2(month)}`,
      invoice_date: invoiceDate,
      due_date: nextMonthDate(2026, month, 5),
      base_amount: 2000,
      cgst_percent: 0,
      sgst_percent: 0,
      cgst_amount: 0,
      sgst_amount: 0,
      total_amount: 2000,
      previous_due: 0,
      penalty_amount: 0,
      cheque_dishonour: 0,
      payable_amount: 2000,
      status: flatStatus(flat, month),
      notes: null,
      is_voided: false,
      void_reason: null,
      voided_at: null,
      created_at: `${invoiceDate}T09:00:00Z`,
      updated_at: `${invoiceDate}T09:00:00Z`,
      units: {
        flat_number,
        flat_area_sqft: 1200,
        is_test_unit: false,
        residents: unitResidents.map(r => ({
          full_name: r.full_name, phone: r.phone, email: r.email,
          notification_channel: r.notification_channel, consent_given: r.consent_given, is_primary: r.is_primary,
        })),
      },
    };
  });
});

// ── payments ───────────────────────────────────────────────────────────────
let recNo = 1;

function makePayment(opts: {
  unit: ReturnType<typeof unitByFlat>;
  amount: number;
  mode: string;
  date: string;
  time: string;
  monthsDetail: string | null;
  monthsCovered: number;
  billIds: string[];
  status: string;
  id?: string;
  notes?: string | null;
  isVoided?: boolean;
  voidReason?: string | null;
  voidedAt?: string | null;
}) {
  const resident = opts.unit.residents[0];
  const receiptNumber = `REC-${pad4(recNo++)}`;
  return {
    id: opts.id ?? `p-${receiptNumber}`,
    society_id: SOCIETY_ID,
    unit_id: opts.unit.id,
    resident_id: resident.id,
    bill_ids: opts.billIds,
    amount_paid: opts.amount,
    payment_mode: opts.mode,
    payment_date: opts.date,
    payment_time: opts.time,
    payment_timestamp: `${opts.date}T${opts.time}Z`,
    utr_reference: null,
    collector_name: null,
    months_covered: opts.monthsCovered,
    months_detail: opts.monthsDetail,
    notes: opts.notes ?? null,
    recorded_by: recordedByFor(opts.date),
    payment_status: opts.status,
    is_voided: opts.isVoided ?? false,
    void_reason: opts.voidReason ?? null,
    voided_by: null,
    voided_at: opts.voidedAt ?? null,
    receipt_number: receiptNumber,
    receipt_generated_at: null,
    receipt_pdf_url: null,
    row_hash: null,
    created_at: `${opts.date}T${opts.time}Z`,
    updated_at: `${opts.date}T${opts.time}Z`,
    units: { flat_number: opts.unit.flat_number, is_test_unit: false },
    residents: { full_name: resident.full_name, phone: null, email: null, notification_channel: 'NONE', consent_given: false },
  };
}

const currentFyPayments = units.flatMap(u => {
  const flat = parseInt(u.flat_number);
  return BILL_MONTHS
    .filter(month => flatStatus(flat, month) === 'PAID')
    .map(month => makePayment({
      unit: u,
      amount: 2000,
      mode: payMode(flat),
      date: PAY_DATES[month][flat % PAY_DATES[month].length],
      time: '10:30:00',
      monthsDetail: monthDetailLabel(2026, month),
      monthsCovered: 1,
      billIds: [`b${u.flat_number}-${month}`],
      status: 'PAID',
      id: `p${u.flat_number}-${month}`,
    }));
});

// A handful of flats — mostly ones that later joined the FY2026-27 defaulter
// list — had a clean payment history the FY before, so the story reads as
// "recently fell behind" rather than "never paid, ever".
const HIST_FLATS = ['408', '410', '501', '505', '510'];
const HIST_MONTHS: Array<{ year: number; month: number }> = [
  { year: 2025, month: 10 }, { year: 2025, month: 11 }, { year: 2025, month: 12 },
  { year: 2026, month: 1 },  { year: 2026, month: 2 },  { year: 2026, month: 3 },
];
const historicalPayments = HIST_FLATS.flatMap(flatNumber =>
  HIST_MONTHS.map(({ year, month }) => makePayment({
    unit: unitByFlat(flatNumber),
    amount: 2000,
    mode: payMode(parseInt(flatNumber)),
    date: `${year}-${pad2(month)}-10`,
    time: '09:45:00',
    monthsDetail: monthDetailLabel(year, month),
    monthsCovered: 1,
    billIds: [],
    status: 'PAID',
  })),
);

// One advance, fully unsettled so far, and one advance already fully applied —
// exercises both states the Advances Ledger page renders.
const advancePayments = [
  makePayment({
    unit: unitByFlat('105'), amount: 6000, mode: 'ADVANCE', date: '2026-07-10', time: '16:00:00',
    monthsDetail: null, monthsCovered: 0, billIds: [], status: 'ADVANCE',
    notes: 'Advance for Aug–Oct 2026 maintenance',
  }),
  makePayment({
    unit: unitByFlat('210'), amount: 4000, mode: 'ADVANCE', date: '2026-05-01', time: '15:00:00',
    monthsDetail: null, monthsCovered: 0, billIds: [], status: 'ADVANCE',
    notes: 'Advance ahead of a planned move',
  }),
];
const ADVANCE_PAYMENT_105_ID = advancePayments[0].id;
const ADVANCE_PAYMENT_210_ID = advancePayments[1].id;

// One duplicate entry, voided the next day — the "small minority" of voided
// records every financial table should carry.
const voidedDuplicatePayment = makePayment({
  unit: unitByFlat('103'), amount: 2000, mode: 'CHEQUE', date: '2026-06-09', time: '11:15:00',
  monthsDetail: 'Jun 2026', monthsCovered: 1, billIds: ['b103-6'], status: 'PAID',
  notes: 'Duplicate of the Jun 2026 receipt', isVoided: true,
  voidReason: 'Recorded twice by mistake, receipt corrected', voidedAt: '2026-06-10T09:00:00Z',
});

export const payments = [
  ...currentFyPayments,
  ...historicalPayments,
  ...advancePayments,
  voidedDuplicatePayment,
];

// ── expenditures ─────────────────────────────────────────────────────────────
const BASE_EXPENSES = [
  { id:'e1',  expense_date:'2026-04-01', category:'SECURITY_AGENCY',   amount:18000, description:'Security agency fee — April' },
  { id:'e2',  expense_date:'2026-05-01', category:'SECURITY_AGENCY',   amount:18000, description:'Security agency fee — May' },
  { id:'e3',  expense_date:'2026-06-01', category:'SECURITY_AGENCY',   amount:18000, description:'Security agency fee — June' },
  { id:'e4',  expense_date:'2026-04-30', category:'WATCHMAN_SALARY',   amount:14000, description:'Watchman salary — April' },
  { id:'e5',  expense_date:'2026-05-31', category:'WATCHMAN_SALARY',   amount:14000, description:'Watchman salary — May' },
  { id:'e6',  expense_date:'2026-06-30', category:'WATCHMAN_SALARY',   amount:14000, description:'Watchman salary — June' },
  { id:'e7',  expense_date:'2026-05-12', category:'ELECTRICITY',       amount:16800, description:'Common area electricity — Apr bill' },
  { id:'e8',  expense_date:'2026-06-11', category:'ELECTRICITY',       amount:14200, description:'Common area electricity — May bill' },
  { id:'e9',  expense_date:'2026-04-18', category:'WATER_MUNICIPAL',   amount: 9400, description:'HMWSSB water charges' },
  { id:'e10', expense_date:'2026-04-05', category:'GARBAGE',           amount: 4200, description:'Garbage collection — quarterly' },
  { id:'e11', expense_date:'2026-05-20', category:'GENERATOR_DIESEL',  amount: 7600, description:'Generator diesel' },
  { id:'e12', expense_date:'2026-04-10', category:'LIFT_AMC',          amount:18000, description:'Lift AMC — Schindler annual contract' },
  { id:'e13', expense_date:'2026-04-01', category:'INTERNET',          amount:  900, description:'Internet — April' },
  { id:'e14', expense_date:'2026-05-01', category:'INTERNET',          amount:  900, description:'Internet — May' },
  { id:'e15', expense_date:'2026-06-01', category:'INTERNET',          amount:  900, description:'Internet — June' },
  { id:'e16', expense_date:'2026-04-20', category:'CLEANING_SUPPLIES', amount: 1050, description:'Cleaning supplies' },
  { id:'e17', expense_date:'2026-05-22', category:'CLEANING_SUPPLIES', amount: 1050, description:'Cleaning supplies' },
  { id:'e18', expense_date:'2026-06-15', category:'CLEANING_SUPPLIES', amount: 1050, description:'Cleaning supplies' },
  { id:'e19', expense_date:'2026-06-10', category:'MISC',              amount: 3800, description:'Bird netting repair' },
  { id:'e20', expense_date:'2026-07-01', category:'SECURITY_AGENCY',   amount:18000, description:'Security agency fee — July' },
  { id:'e21', expense_date:'2026-07-01', category:'WATCHMAN_SALARY',   amount:14000, description:'Watchman salary — July' },
  { id:'e22', expense_date:'2026-07-10', category:'ELECTRICITY',       amount:15500, description:'Common area electricity — Jun bill' },
  { id:'e23', expense_date:'2026-07-01', category:'INTERNET',          amount:  900, description:'Internet — July' },
  { id:'e24', expense_date:'2026-07-14', category:'CLEANING_SUPPLIES', amount: 1050, description:'Cleaning supplies' },
  { id:'e25', expense_date:'2026-07-08', category:'STATIONERY',        amount:  650, description:'Stationery — receipt books' },
];

export const expenditures = [
  ...BASE_EXPENSES.map(e => ({
    ...e,
    society_id: SOCIETY_ID,
    paid_via: null,
    payee_name: null,
    reference_number: null,
    bill_attachment_url: null,
    recorded_by: recordedByFor(e.expense_date),
    notes: null,
    is_voided: false,
    void_reason: null,
    voided_at: null,
    created_at: `${e.expense_date}T12:00:00Z`,
    updated_at: `${e.expense_date}T12:00:00Z`,
  })),
  {
    id: 'e_adv1', society_id: SOCIETY_ID, expense_date: '2026-06-01', category: 'ADVANCE_PAYMENT',
    description: 'Advance for generator overhaul', amount: 15000, paid_via: 'BANK_TRANSFER',
    payee_name: 'Demo Electrical Vendor', reference_number: null, bill_attachment_url: null,
    recorded_by: 'Demo Resident 01', notes: null, is_voided: false, void_reason: null, voided_at: null,
    created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-01T12:00:00Z',
  },
  {
    id: 'e_corpus1', society_id: SOCIETY_ID, expense_date: '2026-06-18', category: 'CORPUS_FUND_PAYMENT',
    description: 'Corpus fund — lobby renovation', amount: 12000, paid_via: 'BANK_TRANSFER',
    payee_name: 'Demo Interiors Vendor', reference_number: null, bill_attachment_url: null,
    recorded_by: 'Demo Resident 01', notes: null, is_voided: false, void_reason: null, voided_at: null,
    created_at: '2026-06-18T12:00:00Z', updated_at: '2026-06-18T12:00:00Z',
  },
  {
    id: 'e_void1', society_id: SOCIETY_ID, expense_date: '2026-05-15', category: 'MISC',
    description: 'Duplicate stationery bill', amount: 650, paid_via: 'CASH',
    payee_name: null, reference_number: null, bill_attachment_url: null,
    recorded_by: 'Demo Resident 01', notes: null, is_voided: true, void_reason: 'Recorded twice by mistake',
    voided_at: '2026-05-16T09:00:00Z', created_at: '2026-05-15T12:00:00Z', updated_at: '2026-05-16T09:00:00Z',
  },
];

// ── other_income ─────────────────────────────────────────────────────────────
export const other_income = [
  { id:'oi1', income_date:'2025-09-10', category:'OTHER_INCOME',    description:'Old newspaper sale', amount: 800 },
  { id:'oi2', income_date:'2025-11-15', category:'PENALTY',         description:'Late payment penalty', amount: 300 },
  { id:'oi3', income_date:'2026-04-10', category:'AD_BOARD_INCOME', description:'Hoarding rent — April', amount: 5000 },
  { id:'oi4', income_date:'2026-04-15', category:'CORPUS_FUND',     description:'Corpus fund contribution — new resident', amount: 5000 },
  { id:'oi5', income_date:'2026-05-10', category:'AD_BOARD_INCOME', description:'Hoarding rent — May', amount: 5000 },
  { id:'oi6', income_date:'2026-05-20', category:'CORPUS_FUND',     description:'Corpus fund contribution', amount: 5000 },
  { id:'oi7', income_date:'2026-06-05', category:'PENALTY',         description:'Late payment penalty — Flat 505', amount: 500 },
  { id:'oi8', income_date:'2026-06-10', category:'AD_BOARD_INCOME', description:'Hoarding rent — June', amount: 5000 },
  { id:'oi9', income_date:'2026-07-05', category:'AD_BOARD_INCOME', description:'Hoarding rent — July', amount: 5000 },
  { id:'oi10',income_date:'2026-07-12', category:'OTHER_INCOME',    description:'Scrap sale', amount: 1200 },
].map(row => ({
  ...row,
  society_id: SOCIETY_ID,
  received_via: 'BANK_TRANSFER',
  reference_number: null,
  recorded_by: recordedByFor(row.income_date),
  notes: null,
  is_voided: false,
  void_reason: null,
  voided_at: null,
  created_at: `${row.income_date}T12:00:00Z`,
  updated_at: `${row.income_date}T12:00:00Z`,
}));

// ── levy_configs ─────────────────────────────────────────────────────────────
export const levy_configs = [
  { id:'lc1', society_id: SOCIETY_ID, levy_label:'CMC-June-22', default_amount:1100, created_at:'2022-06-01T00:00:00Z' },
  { id:'lc2', society_id: SOCIETY_ID, levy_label:'AMC-2023',    default_amount:2000, created_at:'2023-01-01T00:00:00Z' },
  { id:'lc3', society_id: SOCIETY_ID, levy_label:'CMC-2024',    default_amount:1710, created_at:'2024-01-01T00:00:00Z' },
  { id:'lc4', society_id: SOCIETY_ID, levy_label:'CMC-2025',    default_amount:2300, created_at:'2025-01-01T00:00:00Z' },
  { id:'lc5', society_id: SOCIETY_ID, levy_label:'AMC-2026',    default_amount:2300, created_at:'2026-01-01T00:00:00Z' },
];

// ── amc_collections ──────────────────────────────────────────────────────────
const LEVY_RANGES: Array<{ label: string; amount: number; baseDate: string; recordedBy: string; paid: (n: number) => boolean }> = [
  { label:'CMC-June-22', amount:1100, baseDate:'2022-06-15', recordedBy:'Demo Resident 03',   paid:()=>true },
  { label:'AMC-2023',    amount:2000, baseDate:'2023-01-20', recordedBy:'Demo Resident 03',   paid:n=> n<=411 || (n>=501 && n<=508) },
  { label:'CMC-2024',    amount:1710, baseDate:'2024-01-15', recordedBy:'Demo Resident 03',   paid:n=> n<=411 || (n>=501 && n<=504) },
  { label:'CMC-2025',    amount:2300, baseDate:'2025-01-10', recordedBy:'Demo Resident 02',  paid:n=> n<=311 || (n>=401 && n<=410) },
  { label:'AMC-2026',    amount:2300, baseDate:'2026-02-01', recordedBy:'Demo Resident 01', paid:n=> n<=211 },
];

let amcId = 1;
export const amc_collections = LEVY_RANGES.flatMap(({ label, amount, baseDate, recordedBy, paid }) =>
  units.filter(u => paid(parseInt(u.flat_number))).map((u, idx) => {
    const resident = u.residents[0];
    const paymentDate = addDays(baseDate, idx % 25);
    return {
      id: `amc${amcId++}`,
      society_id: SOCIETY_ID,
      unit_id: u.id,
      resident_id: resident.id,
      levy_label: label,
      amount_paid: amount,
      payment_date: paymentDate,
      payment_mode: 'MANUAL_COLLECTION',
      notes: null,
      pdf_url: null,
      recorded_by: recordedBy,
      is_voided: false,
      void_reason: null,
      voided_at: null,
      created_at: `${paymentDate}T11:00:00Z`,
      units: {
        flat_number: u.flat_number,
        is_test_unit: false,
        residents: [{ full_name: resident.full_name, is_primary: true, is_active: true, phone: null, email: null }],
      },
    };
  }),
);

// ── society_config ───────────────────────────────────────────────────────────
export const society_config = [{
  id: 'cfg1',
  society_id: SOCIETY_ID,
  name: 'Demo Apartments',
  registration_number: 'DEMO-REG-001',
  address: 'Demo Building, Example Street, Example City',
  mobile: null,
  pan_number: null,
  gstin: null,
  bank_name: null,
  bank_account_no: null,
  bank_ifsc: null,
  upi_id: null,
  // Demo has no private object storage, so the QR panel stays hidden rather than
  // rendering an image route that can never resolve.
  upi_qr_object_key: null,
  logo_url: null,
  receipt_prefix: 'REC',
  next_receipt_no: recNo,
  monthly_maintenance_amount: 2000,
  penalty_rate_percent: 2,
  maintenance_payment_window_days: 15,
  financial_year_start_month: 4,
  dues_notice_title: 'Maintenance Dues Reminder',
  dues_notice_payby_days: 7,
  dues_notice_footer: 'Please clear dues at the earliest to avoid penalty charges.',
  created_at: '2022-01-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}];

// ── balance_snapshots ─────────────────────────────────────────────────────────
export const balance_snapshots = [
  { id:'bs1', snapshot_date:'2025-03-31', bank_balance:150000, cash_in_hand:10000, notes:'FY2024-25 closing' },
  { id:'bs2', snapshot_date:'2026-03-31', bank_balance:250000, cash_in_hand:15000, notes:'FY2025-26 closing balance' },
  { id:'bs3', snapshot_date:'2026-04-30', bank_balance:280000, cash_in_hand:14000, notes:'End of April' },
  { id:'bs4', snapshot_date:'2026-05-31', bank_balance:310000, cash_in_hand:13500, notes:'End of May' },
  { id:'bs5', snapshot_date:'2026-06-30', bank_balance:340000, cash_in_hand:16000, notes:'End of June' },
  { id:'bs6', snapshot_date:'2026-07-19', bank_balance:352000, cash_in_hand:17500, notes:'Latest count' },
].map(row => ({ ...row, society_id: SOCIETY_ID, created_at: `${row.snapshot_date}T18:00:00Z`, updated_at: `${row.snapshot_date}T18:00:00Z` }));

// ── treasurer_handovers ───────────────────────────────────────────────────────
export const treasurer_handovers = [
  {
    id: 'th1', society_id: SOCIETY_ID, handover_date: '2025-04-01',
    outgoing_treasurer: 'Demo Resident 03', incoming_treasurer: 'Demo Resident 02',
    bank_balance: 150000, cash_in_hand: 10000,
    outstanding_receivables_note: '2 flats behind on March dues',
    notes: 'Smooth handover, all records reconciled.',
    created_at: '2025-04-01T10:00:00Z', updated_at: '2025-04-01T10:00:00Z',
  },
  {
    id: 'th2', society_id: SOCIETY_ID, handover_date: '2026-04-01',
    outgoing_treasurer: 'Demo Resident 02', incoming_treasurer: 'Demo Resident 01',
    bank_balance: 250000, cash_in_hand: 15000,
    outstanding_receivables_note: null,
    notes: 'Handover completed at the AGM.',
    created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z',
  },
];

// ── fy_treasurers ─────────────────────────────────────────────────────────────
export const fy_treasurers = [
  { id:'fyt1', fy_start_year:2024, resident: unitByFlat('301').residents[0] },
  { id:'fyt2', fy_start_year:2025, resident: unitByFlat('201').residents[0] },
  { id:'fyt3', fy_start_year:2026, resident: unitByFlat('101').residents[0] },
].map(({ resident, ...row }) => ({
  ...row,
  society_id: SOCIETY_ID,
  resident_id: resident.id,
  created_at: `${row.fy_start_year}-04-01T00:00:00Z`,
  updated_at: `${row.fy_start_year}-04-01T00:00:00Z`,
  residents: { full_name: resident.full_name },
}));

// ── opening_balances ──────────────────────────────────────────────────────────
export const opening_balances = [
  { id:'ob1', fy_start_year:2025, bank_balance:150000, cash_in_hand:10000, notes:'Carried forward from FY2024-25 handover', recorded_by:'Demo Resident 02' },
  { id:'ob2', fy_start_year:2026, bank_balance:250000, cash_in_hand:15000, notes:'Carried forward from FY2025-26 closing snapshot', recorded_by:'Demo Resident 01' },
].map(row => ({ ...row, society_id: SOCIETY_ID, created_at: `${row.fy_start_year}-04-01T09:00:00Z`, updated_at: `${row.fy_start_year}-04-01T09:00:00Z` }));

// ── fund_ledger_entries ────────────────────────────────────────────────────────
export const fund_ledger_entries = [
  { id:'fle1', fund_type:'CORPUS',  entry_type:'CONTRIBUTION', amount:50000, entry_date:'2025-04-05', source_table:null,             source_id:null,       notes:'Opening corpus contribution' },
  { id:'fle2', fund_type:'CORPUS',  entry_type:'INTEREST',     amount: 1200, entry_date:'2025-10-05', source_table:null,             source_id:null,       notes:'FD interest' },
  { id:'fle3', fund_type:'CORPUS',  entry_type:'OUTFLOW',      amount: 8000, entry_date:'2025-12-20', source_table:null,             source_id:null,       notes:'Corpus-funded repair' },
  { id:'fle4', fund_type:'CORPUS',  entry_type:'CONTRIBUTION', amount:55000, entry_date:'2026-04-05', source_table:'other_income',   source_id:'oi3',      notes:'FY2026-27 corpus contribution' },
  { id:'fle5', fund_type:'CORPUS',  entry_type:'CONTRIBUTION', amount: 5000, entry_date:'2026-05-20', source_table:'other_income',   source_id:'oi6',      notes:'Corpus fund contribution' },
  { id:'fle6', fund_type:'CORPUS',  entry_type:'OUTFLOW',      amount:12000, entry_date:'2026-06-18', source_table:'expenditures',   source_id:'e_corpus1',notes:'Lobby renovation' },
  { id:'fle7', fund_type:'CORPUS',  entry_type:'INTEREST',     amount:  900, entry_date:'2026-07-10', source_table:null,             source_id:null,       notes:'FD interest' },
  { id:'fle8', fund_type:'CORPUS',  entry_type:'CONTRIBUTION', amount: 4000, entry_date:'2026-07-15', source_table:null,             source_id:null,       notes:'Corpus fund contribution' },
  { id:'fle9', fund_type:'SINKING', entry_type:'CONTRIBUTION', amount:20000, entry_date:'2025-05-01', source_table:null,             source_id:null,       notes:'Sinking fund contribution' },
  { id:'fle10',fund_type:'SINKING', entry_type:'CONTRIBUTION', amount:20000, entry_date:'2025-11-01', source_table:null,             source_id:null,       notes:'Sinking fund contribution' },
  { id:'fle11',fund_type:'SINKING', entry_type:'CONTRIBUTION', amount:22000, entry_date:'2026-05-01', source_table:null,             source_id:null,       notes:'Sinking fund contribution' },
  { id:'fle12',fund_type:'SINKING', entry_type:'OUTFLOW',      amount: 6000, entry_date:'2026-07-05', source_table:null,             source_id:null,       notes:'Lift sinking-fund repair' },
].map(row => ({ ...row, society_id: SOCIETY_ID, is_voided: false, void_reason: null, voided_at: null, created_at: `${row.entry_date}T12:00:00Z` }));

// ── advance_settlements ─────────────────────────────────────────────────────────
export const advance_settlements = [
  { id:'advs1', advance_kind:'PAYMENT', advance_id: ADVANCE_PAYMENT_105_ID, settled_amount:2000, settled_against:'Partial application — Aug 2026 maintenance', settled_date:'2026-07-18' },
  { id:'advs2', advance_kind:'PAYMENT', advance_id: ADVANCE_PAYMENT_210_ID, settled_amount:4000, settled_against:'Fully applied to May+Jun 2026 dues', settled_date:'2026-06-01' },
  { id:'advs3', advance_kind:'EXPENSE', advance_id:'e_adv1', settled_amount:7000, settled_against:'Partial completion — generator overhaul', settled_date:'2026-07-05' },
  { id:'advs4', advance_kind:'EXPENSE', advance_id:'e_adv1', settled_amount:3000, settled_against:'Final completion payment — generator overhaul', settled_date:'2026-07-18' },
].map(row => ({ ...row, society_id: SOCIETY_ID, notes: null, is_voided: false, void_reason: null, voided_at: null, created_at: `${row.settled_date}T12:00:00Z` }));

// ── bank_statement_batches + bank_statement_lines ────────────────────────────────
export const bank_statement_batches = [
  { id:'bsb1', society_id: SOCIETY_ID, filename:'demo-statement-june-2026.csv', statement_from:'2026-06-01', statement_to:'2026-06-30', line_count:10, uploaded_by:null, uploaded_at:'2026-07-02T10:00:00Z' },
  { id:'bsb2', society_id: SOCIETY_ID, filename:'demo-statement-july-2026.csv', statement_from:'2026-07-01', statement_to:'2026-07-19', line_count:10, uploaded_by:null, uploaded_at:'2026-07-20T09:00:00Z' },
];

export const bank_statement_lines = [
  // Batch 1 — June, mostly reconciled
  { id:'bsl1',  batch_id:'bsb1', line_date:'2026-06-02', description:'UPI-101-MAINT',      amount:2000,  reference:null, matched_table:'payments',        matched_id:'p101-6', ignored:false },
  { id:'bsl2',  batch_id:'bsb1', line_date:'2026-06-05', description:'NEFT-201-MAINT',      amount:2000,  reference:null, matched_table:'payments',        matched_id:'p201-6', ignored:false },
  { id:'bsl3',  batch_id:'bsb1', line_date:'2026-06-01', description:'SECURITY AGENCY JUN', amount:-18000,reference:null, matched_table:'expenditures',     matched_id:'e3',     ignored:false },
  { id:'bsl4',  batch_id:'bsb1', line_date:'2026-06-30', description:'WATCHMAN SALARY JUN', amount:-14000,reference:null, matched_table:'expenditures',     matched_id:'e6',     ignored:false },
  { id:'bsl5',  batch_id:'bsb1', line_date:'2026-06-12', description:'UPI-104-MAINT',       amount:2000,  reference:null, matched_table:'payments',        matched_id:null,     ignored:false },
  { id:'bsl6',  batch_id:'bsb1', line_date:'2026-06-16', description:'CASH DEPOSIT',        amount:2000,  reference:null, matched_table:null,               matched_id:null,     ignored:false },
  { id:'bsl7',  batch_id:'bsb1', line_date:'2026-06-20', description:'NEFT UNKNOWN123',     amount:2450,  reference:null, matched_table:null,               matched_id:null,     ignored:false },
  { id:'bsl8',  batch_id:'bsb1', line_date:'2026-06-08', description:'POS CHARGE REVERSAL', amount:-150,  reference:null, matched_table:null,               matched_id:null,     ignored:true },
  { id:'bsl9',  batch_id:'bsb1', line_date:'2026-06-15', description:'BANK CHARGES',        amount:-236,  reference:null, matched_table:null,               matched_id:null,     ignored:false },
  { id:'bsl10', batch_id:'bsb1', line_date:'2026-06-11', description:'ELECTRICITY BILL MAY',amount:-14200,reference:null, matched_table:'expenditures',     matched_id:'e8',     ignored:false },
  // Batch 2 — July, still has unresolved lines (the demo of an in-progress reconciliation)
  { id:'bsl11', batch_id:'bsb2', line_date:'2026-07-02', description:'UPI-101-MAINT',       amount:2000,  reference:null, matched_table:'payments',        matched_id:'p101-7', ignored:false },
  { id:'bsl12', batch_id:'bsb2', line_date:'2026-07-01', description:'SECURITY AGENCY JUL', amount:-18000,reference:null, matched_table:'expenditures',     matched_id:'e20',    ignored:false },
  { id:'bsl13', batch_id:'bsb2', line_date:'2026-07-16', description:'UPI-105-MAINT',       amount:2000,  reference:null, matched_table:null,               matched_id:null,     ignored:false },
  { id:'bsl14', batch_id:'bsb2', line_date:'2026-07-10', description:'ADVANCE-105',         amount:6000,  reference:null, matched_table:'payments',        matched_id: ADVANCE_PAYMENT_105_ID, ignored:false },
  { id:'bsl15', batch_id:'bsb2', line_date:'2026-07-01', description:'WATCHMAN SALARY JUL', amount:-14000,reference:null, matched_table:'expenditures',     matched_id:'e21',    ignored:false },
  { id:'bsl16', batch_id:'bsb2', line_date:'2026-07-14', description:'CLEANING SUPPLIES',   amount:-1050, reference:null, matched_table:null,               matched_id:null,     ignored:false },
  { id:'bsl17', batch_id:'bsb2', line_date:'2026-07-17', description:'NEFT UNRECOGNISED',   amount:3100,  reference:null, matched_table:null,               matched_id:null,     ignored:false },
  { id:'bsl18', batch_id:'bsb2', line_date:'2026-07-08', description:'STATIONERY BILL',     amount:-650,  reference:null, matched_table:'expenditures',     matched_id:'e25',    ignored:false },
  { id:'bsl19', batch_id:'bsb2', line_date:'2026-07-05', description:'ADVANCE SETTLEMENT',  amount:-7000, reference:null, matched_table:null,               matched_id:null,     ignored:false },
  { id:'bsl20', batch_id:'bsb2', line_date:'2026-07-19', description:'ATM CASH WITHDRAWAL', amount:-5000, reference:null, matched_table:null,               matched_id:null,     ignored:true },
].map(({ ignored, ...row }) => ({
  ...row,
  matched_at: row.matched_id ? `${row.line_date}T20:00:00Z` : null,
  matched_by: null,
  is_ignored: ignored,
  created_at: `${row.line_date}T20:00:00Z`,
}));

// ── society_notices ───────────────────────────────────────────────────────────
export const society_notices = [
  { id:'n1', title:'Welcome to the Trezia demo', body:'This is a live, read-only demo of Trezia — a maintenance and accounts app built for volunteer treasurers. Browse Payments, Reports, and the Balance Sheet to see it in action.', category:'GENERAL', audience:'ALL_MEMBERS', is_pinned:true,  published_at:'2026-07-01T09:00:00Z', expires_at:null, archived_at:null },
  { id:'n2', title:'Water tank cleaning scheduled', body:'The overhead water tank will be cleaned on Saturday, 25 Jul, between 10 AM and 1 PM. Water supply will be interrupted during this window.', category:'MAINTENANCE', audience:'RESIDENTS', is_pinned:false, published_at:'2026-07-15T09:00:00Z', expires_at:'2026-07-26T00:00:00Z', archived_at:null },
  { id:'n3', title:'Fire drill on Saturday', body:'A mandatory fire safety drill is scheduled for all residents this Saturday at 11 AM in the parking area. Please participate.', category:'SAFETY', audience:'ALL_MEMBERS', is_pinned:false, published_at:'2026-07-14T09:00:00Z', expires_at:null, archived_at:null },
  { id:'n4', title:'Committee meeting — Ganesh Chaturthi celebrations', body:'Committee members, please confirm your availability for the planning meeting on 28 Jul to discuss this year’s celebration budget.', category:'EVENT', audience:'OPERATORS', is_pinned:false, published_at:'2026-07-10T09:00:00Z', expires_at:null, archived_at:null },
  { id:'n5', title:'AMC-2026 collection reminder', body:'Flats up to 211 have cleared AMC 2026. Remaining flats are requested to pay the ₹2,300 AMC amount at the earliest.', category:'FINANCE', audience:'ALL_MEMBERS', is_pinned:false, published_at:'2026-07-05T09:00:00Z', expires_at:null, archived_at:null },
  { id:'n6', title:'AGM minutes uploaded', body:'Minutes from the FY2026-27 Annual General Meeting have been uploaded to the Documents section under Operations.', category:'GOVERNANCE', audience:'ALL_MEMBERS', is_pinned:false, published_at:'2026-04-05T09:00:00Z', expires_at:null, archived_at:'2026-06-01T00:00:00Z' },
].map(row => ({ ...row, society_id: SOCIETY_ID, created_by: 'demo-user', created_at: row.published_at, updated_at: row.published_at }));

// ── society_documents ─────────────────────────────────────────────────────────
export const society_documents = [
  { id:'doc1', title:'Society Bylaws (2020 revision)',       category:'BYLAWS',       description:'Governing bylaws as amended in 2020.',        document_date:'2020-01-15', published_to_residents:true,  archived_at:null },
  { id:'doc2', title:'Registration Certificate',              category:'REGISTRATION', description:'Society registration certificate.',           document_date:'2019-11-01', published_to_residents:false, archived_at:null },
  { id:'doc3', title:'FY2024-25 Audit Report',                 category:'AUDIT_REPORT', description:'Statutory audit report for FY2024-25.',       document_date:'2025-06-30', published_to_residents:true,  archived_at:null },
  { id:'doc4', title:'FY2025-26 Audit Report',                 category:'AUDIT_REPORT', description:'Statutory audit report for FY2025-26.',       document_date:'2026-06-30', published_to_residents:true,  archived_at:null },
  { id:'doc5', title:'AGM Minutes — April 2026',               category:'AGM_MINUTES',  description:'Minutes from the FY2026-27 Annual General Meeting.', document_date:'2026-04-05', published_to_residents:true,  archived_at:null },
  { id:'doc6', title:'Parking Policy Circular',                category:'CIRCULAR',     description:'Updated visitor parking policy.',              document_date:'2026-05-01', published_to_residents:true,  archived_at:null },
  { id:'doc7', title:'NOC Application Form',                   category:'FORM',         description:'No-objection certificate application form.',  document_date:'2024-01-01', published_to_residents:false, archived_at:null },
  { id:'doc8', title:'Security Contract FY2025-26 (superseded)',category:'CONTRACT',     description:'Prior year security services contract.',      document_date:'2025-04-01', published_to_residents:false, archived_at:'2026-04-15T00:00:00Z' },
].map(row => ({ ...row, society_id: SOCIETY_ID, created_by: 'demo-user', created_at: `${row.document_date}T09:00:00Z`, updated_at: `${row.document_date}T09:00:00Z` }));

// ── vendors + vendor_contracts ─────────────────────────────────────────────────
export const vendors = [
  { id:'v1', name:'Demo Security Vendor', service_category:'Security',  contact_name:'Demo Contact 01',  phone:null, email:null, address:null, notes:null, archived_at:null },
  { id:'v2', name:'Demo Watchman Vendor',     service_category:'Watchman',  contact_name:'Demo Contact 02',  phone:null, email:null, address:null, notes:null, archived_at:null },
  { id:'v3', name:'Demo Electrical Vendor', service_category:'Electrical',contact_name:'Demo Contact 03',  phone:null, email:null, address:null, notes:null, archived_at:null },
  { id:'v4', name:'Demo Plumbing Vendor',         service_category:'Plumbing',  contact_name:'Demo Contact 04',  phone:null, email:null, address:null, notes:null, archived_at:null },
  { id:'v5', name:'Demo Lift Vendor',           service_category:'Lift AMC',  contact_name:'Demo Contact 05',  phone:null, email:null, address:null, notes:null, archived_at:null },
  { id:'v6', name:'Demo Cleaning Vendor',      service_category:'Cleaning',  contact_name:'Demo Contact 06', phone:null, email:null, address:null, notes:'Contract not renewed for FY2026-27.', archived_at:'2026-01-01T00:00:00Z' },
].map(row => ({ ...row, society_id: SOCIETY_ID, created_by: 'demo-user', created_at: '2022-01-01T00:00:00Z', updated_at: '2022-01-01T00:00:00Z' }));

export const vendor_contracts = [
  { id:'vc1', vendor_id:'v1', title:'Security Services FY2026-27',    contract_value:216000, start_date:'2026-04-01', end_date:'2027-03-31', renewal_notice_days:30, status:'ACTIVE' },
  { id:'vc2', vendor_id:'v2', title:'Watchman Services FY2026-27',    contract_value:168000, start_date:'2026-04-01', end_date:'2027-03-31', renewal_notice_days:30, status:'ACTIVE' },
  { id:'vc3', vendor_id:'v5', title:'Lift AMC 2026',                  contract_value: 18000, start_date:'2026-01-01', end_date:'2026-12-31', renewal_notice_days:45, status:'ACTIVE' },
  { id:'vc4', vendor_id:'v3', title:'Electrical maintenance 2025',    contract_value: 24000, start_date:'2025-01-01', end_date:'2025-12-31', renewal_notice_days:30, status:'EXPIRED' },
  { id:'vc5', vendor_id:'v4', title:'Plumbing on-call 2026',          contract_value:null,   start_date:'2026-01-01', end_date:'2026-12-31', renewal_notice_days:30, status:'ACTIVE' },
  { id:'vc6', vendor_id:'v6', title:'Cleaning services 2025',         contract_value: 60000, start_date:'2025-01-01', end_date:'2025-12-31', renewal_notice_days:30, status:'TERMINATED' },
].map(row => ({ ...row, society_id: SOCIETY_ID, notes: null, archived_at: row.status === 'TERMINATED' ? '2026-01-01T00:00:00Z' : null, created_by: 'demo-user', created_at: `${row.start_date}T09:00:00Z`, updated_at: `${row.start_date}T09:00:00Z` }));

// ── assets + asset_service_records ────────────────────────────────────────────
export const assets = [
  { id:'ast1', vendor_id:'v5', name:'Lift 1',              category:'LIFT',                  location:'Block A', purchase_date:'2019-06-01', warranty_expires_on:'2021-06-01', next_service_date:'2026-10-15', status:'ACTIVE' },
  { id:'ast2', vendor_id:'v5', name:'Lift 2',              category:'LIFT',                  location:'Block B', purchase_date:'2019-06-01', warranty_expires_on:'2021-06-01', next_service_date:'2026-10-15', status:'ACTIVE' },
  { id:'ast3', vendor_id:null, name:'Diesel Generator',    category:'GENERATOR',             location:'Basement', purchase_date:'2020-02-01', warranty_expires_on:'2022-02-01', next_service_date:'2026-09-01', status:'ACTIVE' },
  { id:'ast4', vendor_id:'v4', name:'Water Pump',          category:'PUMP',                  location:'Basement', purchase_date:'2021-03-01', warranty_expires_on:'2023-03-01', next_service_date:'2026-11-10', status:'ACTIVE' },
  { id:'ast5', vendor_id:'v3', name:'CCTV System',         category:'SECURITY_EQUIPMENT',    location:'Gate & lobby', purchase_date:'2022-01-15', warranty_expires_on:'2024-01-15', next_service_date:'2027-02-01', status:'ACTIVE' },
  { id:'ast6', vendor_id:null, name:'Fire Extinguishers',  category:'SAFETY',                location:'All floors', purchase_date:'2020-06-01', warranty_expires_on:null, next_service_date:'2026-07-25', status:'UNDER_REPAIR' },
  { id:'ast7', vendor_id:'v3', name:'Intercom System',     category:'COMMUNICATION',         location:'Gate', purchase_date:'2018-09-01', warranty_expires_on:'2020-09-01', next_service_date:'2026-12-10', status:'ACTIVE' },
  { id:'ast8', vendor_id:null, name:'Main Gate Motor',     category:'GATE',                  location:'Main gate', purchase_date:'2017-04-01', warranty_expires_on:'2019-04-01', next_service_date:'2026-07-25', status:'OUT_OF_SERVICE' },
].map(row => ({ ...row, society_id: SOCIETY_ID, notes: null, archived_at: null, created_by: 'demo-user', created_at: `${row.purchase_date}T09:00:00Z`, updated_at: '2026-07-01T09:00:00Z' }));

export const asset_service_records = [
  { id:'sr1',  asset_id:'ast1', vendor_id:'v5',  service_date:'2026-01-15', next_service_date:'2026-04-15', description:'Quarterly lift service',                    amount:4500 },
  { id:'sr2',  asset_id:'ast1', vendor_id:'v5',  service_date:'2026-04-15', next_service_date:'2026-07-15', description:'Quarterly lift service',                    amount:4500 },
  { id:'sr3',  asset_id:'ast1', vendor_id:'v5',  service_date:'2026-07-15', next_service_date:'2026-10-15', description:'Quarterly lift service',                    amount:4500 },
  { id:'sr4',  asset_id:'ast2', vendor_id:'v5',  service_date:'2026-01-15', next_service_date:'2026-04-15', description:'Quarterly lift service',                    amount:4500 },
  { id:'sr5',  asset_id:'ast2', vendor_id:'v5',  service_date:'2026-04-15', next_service_date:'2026-07-15', description:'Quarterly lift service',                    amount:4500 },
  { id:'sr6',  asset_id:'ast2', vendor_id:'v5',  service_date:'2026-07-15', next_service_date:'2026-10-15', description:'Quarterly lift service',                    amount:4500 },
  { id:'sr7',  asset_id:'ast3', vendor_id:null,  service_date:'2026-03-01', next_service_date:'2026-09-01', description:'Generator annual service',                  amount:8000 },
  { id:'sr8',  asset_id:'ast4', vendor_id:'v4',  service_date:'2026-05-10', next_service_date:'2026-11-10', description:'Pump motor check',                          amount:1500 },
  { id:'sr9',  asset_id:'ast5', vendor_id:'v3',  service_date:'2026-02-01', next_service_date:'2027-02-01', description:'CCTV camera replacement (2 units)',         amount:6000 },
  { id:'sr10', asset_id:'ast6', vendor_id:null,  service_date:'2026-06-20', next_service_date:'2026-07-25', description:'Extinguisher refill due',                   amount: 800 },
  { id:'sr11', asset_id:'ast7', vendor_id:'v3',  service_date:'2025-12-10', next_service_date:'2026-12-10', description:'Intercom wiring fix',                       amount:2200 },
  { id:'sr12', asset_id:'ast8', vendor_id:null,  service_date:'2026-07-10', next_service_date:'2026-07-25', description:'Gate motor failure — awaiting replacement part', amount:0 },
].map(row => ({ ...row, society_id: SOCIETY_ID, notes: null, archived_at: null, created_by: 'demo-user', created_at: `${row.service_date}T09:00:00Z`, updated_at: `${row.service_date}T09:00:00Z` }));

// ── society_attachments ────────────────────────────────────────────────────────
export const society_attachments = [
  { id:'att1', document_id:'doc1', vendor_contract_id:null, asset_id:null, asset_service_record_id:null, notice_id:null, filename:'bylaws-2020.pdf',            content_type:'application/pdf', byte_size:245000 },
  { id:'att2', document_id:'doc3', vendor_contract_id:null, asset_id:null, asset_service_record_id:null, notice_id:null, filename:'audit-report-2024-25.pdf',   content_type:'application/pdf', byte_size:198000 },
  { id:'att3', document_id:null,  vendor_contract_id:'vc1', asset_id:null, asset_service_record_id:null, notice_id:null, filename:'security-contract-2026.pdf', content_type:'application/pdf', byte_size:132000 },
  { id:'att4', document_id:null,  vendor_contract_id:null, asset_id:'ast6', asset_service_record_id:null, notice_id:null, filename:'fire-extinguisher-photo.jpg', content_type:'image/jpeg',      byte_size: 84000 },
  { id:'att5', document_id:null,  vendor_contract_id:null, asset_id:null, asset_service_record_id:'sr9', notice_id:null, filename:'cctv-invoice.pdf',           content_type:'application/pdf', byte_size: 56000 },
  { id:'att6', document_id:null,  vendor_contract_id:null, asset_id:null, asset_service_record_id:null, notice_id:'n6', filename:'agm-minutes-scan.jpg',        content_type:'image/jpeg',       byte_size:120000 },
].map((row, i) => ({
  ...row,
  society_id: SOCIETY_ID,
  sha256: `demo${String(i + 1).padStart(3, '0')}${'0'.repeat(58)}`,
  object_key: `${SOCIETY_ID}/attachments/${row.id}`,
  created_by: 'demo-user',
  archived_at: null,
  created_at: '2026-04-05T09:00:00Z',
}));

// ── societies + society_memberships + resident_invites ───────────────────────
export const societies = [{
  id: SOCIETY_ID,
  slug: 'demo-apartments',
  name: 'Demo Apartments',
  short_name: 'DA',
  address: 'Demo Building, Example Street, Example City',
  primary_contact_name: 'Demo Resident 01',
  contact_phone: null,
  contact_email: null,
  upi_vpa: null,
  fy_start_month: 4,
  status: 'active',
  is_active: true,
  suspended_at: null,
  suspended_by: null,
  suspension_reason: null,
  legacy_storage_layout: null,
  created_at: '2022-01-01T00:00:00Z',
}];

export const society_memberships = [
  { id:'sm1', user_id:'demo-user',      society_id: SOCIETY_ID, role:'admin',     unit_id:null },
  { id:'sm2', user_id:'demo-treasurer', society_id: SOCIETY_ID, role:'treasurer', unit_id:null },
  { id:'sm3', user_id:'demo-resident',  society_id: SOCIETY_ID, role:'resident',  unit_id: unitByFlat('205').id },
].map(row => ({ ...row, status: 'active', revoked_at: null, revoked_by: null, created_at: '2022-01-01T00:00:00Z', updated_at: '2022-01-01T00:00:00Z' }));

export const resident_invites = [
  { id:'ri1', email:'newresident@example.com',     role:'resident',  unit_id: unitByFlat('205').id, claimed_at:null,                     claimed_by:null },
  { id:'ri2', email:'treasurer.helper@example.com',role:'treasurer', unit_id:null,                   claimed_at:'2026-04-02T09:00:00Z',   claimed_by:'demo-treasurer' },
].map(row => ({ ...row, society_id: SOCIETY_ID, invited_by: 'demo-user', created_at: '2026-04-01T09:00:00Z', revoked_at: null, revoked_by: null }));

// ── v_monthly_collections (derived from `payments` for internal consistency) ──
const collectionsByMonth = new Map<string, { total: number; count: number }>();
for (const p of payments) {
  if (p.is_voided) continue;
  const key = p.payment_date.slice(0, 7);
  const cur = collectionsByMonth.get(key) ?? { total: 0, count: 0 };
  cur.total += p.amount_paid;
  cur.count += 1;
  collectionsByMonth.set(key, cur);
}
export const v_monthly_collections = [...collectionsByMonth.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, { total, count }]) => ({ month: `${key}-01`, total_collected: total, payment_count: count }));

// ── v_monthly_expenditures (derived from `expenditures`) ──────────────────────
const expendituresByMonth = new Map<string, number>();
for (const e of expenditures) {
  if (e.is_voided) continue;
  const key = e.expense_date.slice(0, 7);
  expendituresByMonth.set(key, (expendituresByMonth.get(key) ?? 0) + e.amount);
}
export const v_monthly_expenditures = [...expendituresByMonth.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, total]) => ({ month: `${key}-01`, total_expenditure: total }));

// ── v_dues_summary (OVERDUE + ISSUED unpaid bills — same as the real view) ───
export const v_dues_summary = units
  .map(u => {
    const unpaid = bills.filter(b => b.unit_id === u.id && (b.status === 'OVERDUE' || b.status === 'ISSUED'));
    const total_due = unpaid.reduce((s, b) => s + b.payable_amount, 0);
    const paidDates = payments.filter(p => p.unit_id === u.id && !p.is_voided).map(p => p.payment_date).sort();
    return {
      society_id: SOCIETY_ID,
      unit_id: u.id,
      flat_number: u.flat_number,
      primary_resident: u.residents[0]?.full_name ?? null,
      phone: null,
      email: null,
      unpaid_months: unpaid.length,
      total_due,
      last_paid_date: paidDates.length > 0 ? paidDates[paidDates.length - 1] : null,
    };
  })
  .filter(row => row.total_due > 0);

// Community view is redacted (flat + amount only) but unlike v_dues_summary
// includes every flat, paid or not — the RPC that backs /community.
const communityDues = units.map(u => {
  const unpaid = bills.filter(b => b.unit_id === u.id && (b.status === 'OVERDUE' || b.status === 'ISSUED'));
  return { flat_number: u.flat_number, total_due: unpaid.reduce((s, b) => s + b.payable_amount, 0) };
});

// ── audit_log ──────────────────────────────────────────────────────────────────
export const audit_log = [
  { id:1,  action:'INSERT',            table_name:'residents',    record_id:'r101',    performed_by:'demo-user', created_at:'2022-01-01T09:00:00Z', notes:'Resident record created' },
  { id:2,  action:'INSERT',            table_name:'payments',     record_id:'p101-4',  performed_by:'demo-user', created_at:'2026-04-03T10:30:00Z', notes:'Maintenance payment recorded' },
  { id:3,  action:'RECEIPT_GENERATED', table_name:'payments',     record_id:'p101-4',  performed_by:'demo-user', created_at:'2026-04-03T10:31:00Z', notes:'Receipt PDF generated' },
  { id:4,  action:'INSERT',            table_name:'bills',        record_id:'b101-7',  performed_by:'demo-user', created_at:'2026-07-01T09:00:00Z', notes:'Bill generated' },
  { id:5,  action:'BILL_GENERATED',    table_name:'bills',        record_id:'b101-7',  performed_by:'demo-user', created_at:'2026-07-01T09:00:00Z', notes:'Bulk bill generation — July 2026' },
  { id:6,  action:'INSERT',            table_name:'expenditures', record_id:'e20',     performed_by:'demo-user', created_at:'2026-07-01T12:00:00Z', notes:'Expense recorded' },
  { id:7,  action:'SOFT_DELETE',       table_name:'payments',     record_id: voidedDuplicatePayment.id, performed_by:'demo-user', created_at:'2026-06-10T09:00:00Z', notes:'Payment voided — duplicate entry' },
  { id:8,  action:'UPDATE',            table_name:'residents',    record_id:'r205',    performed_by:'demo-user', created_at:'2026-05-01T09:00:00Z', notes:'Resident details updated' },
  { id:9,  action:'EXPORT',            table_name:'payments',     record_id:null,      performed_by:'demo-user', created_at:'2026-07-10T09:00:00Z', notes:'CSV export — payments' },
  { id:10, action:'LOGIN',             table_name:'auth',         record_id:null,      performed_by:'demo-user', created_at:'2026-07-19T08:00:00Z', notes:null },
  { id:11, action:'LOGOUT',            table_name:'auth',         record_id:null,      performed_by:'demo-user', created_at:'2026-07-19T18:00:00Z', notes:null },
  { id:12, action:'INSERT',            table_name:'amc_collections', record_id:'amc1', performed_by:'demo-user', created_at:'2022-06-15T11:00:00Z', notes:'AMC payment recorded' },
  { id:13, action:'INSERT',            table_name:'levy_configs', record_id:'lc5',     performed_by:'demo-user', created_at:'2026-01-01T09:00:00Z', notes:'AMC yearly amount added — AMC-2026' },
  { id:14, action:'UPDATE',            table_name:'other_income', record_id:'oi3',     performed_by:'demo-user', created_at:'2026-04-10T12:00:00Z', notes:'Other income recorded' },
  { id:15, action:'LOGIN',             table_name:'auth',         record_id:null,      performed_by:'demo-user', created_at:'2026-07-20T08:00:00Z', notes:null },
].map(row => ({ ...row, society_id: SOCIETY_ID, old_data: null, new_data: null, ip_address: null, user_agent: null, session_id: null }));

// ── DEMO_DATA lookup map ──────────────────────────────────────────────────────
export const DEMO_DATA: Record<string, unknown[]> = {
  units,
  residents,
  bills,
  payments,
  expenditures,
  other_income,
  amc_collections,
  levy_configs,
  society_config,
  balance_snapshots,
  audit_log,
  treasurer_handovers,
  fy_treasurers,
  opening_balances,
  fund_ledger_entries,
  advance_settlements,
  bank_statement_batches,
  bank_statement_lines,
  society_notices,
  society_documents,
  vendors,
  vendor_contracts,
  assets,
  asset_service_records,
  society_attachments,
  societies,
  society_memberships,
  resident_invites,
  v_monthly_collections,
  v_monthly_expenditures: v_monthly_expenditures as unknown[],
  v_dues_summary: v_dues_summary as unknown[],
};

// ── DEMO_RPC — static return values for every Postgres function the app calls.
// The mock client (lib/supabase/mock-client.ts) looks up `rpc(name, args)`
// against this map; args are intentionally ignored — every demo write is a
// no-op and every demo read returns the same fixture-derived value.
export const DEMO_RPC: Record<string, unknown> = {
  // ── Resident-facing reads (redacted — flat/amount only, never PII) ─────────
  get_community_dues: communityDues,
  get_resident_society_payment_info: [{
    society_name: society_config[0]?.name ?? null,
    treasurer_mobile: society_config[0]?.mobile ?? null,
    upi_id: society_config[0]?.upi_id ?? null,
    upi_qr_object_key: society_config[0]?.upi_qr_object_key ?? null,
  }],
  get_resident_monthly_summary: [{
    month_start: v_monthly_collections[v_monthly_collections.length - 1]?.month ?? '2026-07-01',
    total_collected: v_monthly_collections[v_monthly_collections.length - 1]?.total_collected ?? 0,
    total_spent: v_monthly_expenditures[v_monthly_expenditures.length - 1]?.total_expenditure ?? 0,
  }],
  list_resident_documents: society_documents
    .filter(d => d.published_to_residents && !d.archived_at)
    .map(d => ({
      id: d.id, title: d.title, category: d.category, description: d.description,
      document_date: d.document_date, published_to_residents: d.published_to_residents,
      archived_at: d.archived_at, created_at: d.created_at, updated_at: d.updated_at,
    })),
  list_resident_attachments: society_attachments
    .filter(a => a.document_id === 'doc1' || a.notice_id === 'n6')
    .map(a => ({ id: a.id, filename: a.filename, content_type: a.content_type, byte_size: a.byte_size, created_at: a.created_at })),
  get_resident_attachment: [{
    id: society_attachments[0].id, filename: society_attachments[0].filename,
    content_type: society_attachments[0].content_type, byte_size: society_attachments[0].byte_size,
  }],
  get_public_privacy_contact: [{ name: society_config[0].name, address: society_config[0].address, mobile: society_config[0].mobile }],

  // ── Write / lifecycle RPCs — benign success shapes; nothing is persisted ────
  claim_access_invite: [{ app_role: 'admin' }],
  claim_access_authorizations: null,
  create_access_invite: 'demo-invite-id',
  revoke_access_invite: true,
  submit_access_request: null,
  decide_access_request: null,
  set_fy_treasurer_and_backfill: { id: 'fyt3', fy_start_year: 2026, resident_id: unitByFlat('101').residents[0].id, backfilled_count: 0 },
  create_advance_settlement: {
    id: 'advs-demo', society_id: SOCIETY_ID, advance_kind: 'PAYMENT', advance_id: ADVANCE_PAYMENT_105_ID,
    settled_amount: 0, settled_against: 'Demo settlement', settled_date: '2026-07-20',
    notes: null, is_voided: false, void_reason: null, voided_at: null, created_at: '2026-07-20T00:00:00Z',
  },
  create_bank_statement_batch: {
    id: 'bsb-demo', society_id: SOCIETY_ID, filename: 'demo-upload.csv', statement_from: '2026-07-01',
    statement_to: '2026-07-20', line_count: 0, uploaded_by: null, uploaded_at: '2026-07-20T00:00:00Z',
  },
  create_platform_society: { id: 'demo-society-new', slug: 'demo-society-new' },
  create_platform_admin_authorization: 'demo-admin-invite-id',
  set_society_suspension: null,
};
