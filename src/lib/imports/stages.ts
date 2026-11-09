// the recommended dependency order; each stage is one all-or-nothing transaction.
// This module is the single source of truth for the column contract shared by
// the CSV template endpoint, the validation pass, and migration 063's commit
// RPCs. Keep the three in agreement.

export type ImportStage =
  | 'flats'
  | 'residents'
  | 'opening_balances'
  | 'levy_configs'
  | 'bills'
  | 'payments'
  | 'levy_collections'
  | 'expenses'
  | 'other_income';

// Recommended dependency order. Existing referenced records may make it safe to
// start later; unresolved relationships are still rejected during validation.
export const IMPORT_STAGES: readonly ImportStage[] = [
  'flats',
  'residents',
  'opening_balances',
  'levy_configs',
  'bills',
  'payments',
  'levy_collections',
  'expenses',
  'other_income',
];

export type CellType = 'text' | 'number' | 'integer' | 'date' | 'boolean' | 'enum';

export interface StageColumn {
  key: string;
  label: string;
  required: boolean;
  type: CellType;
  enumValues?: readonly string[];
  example: string;
  help?: string;
}

export interface StageDef {
  stage: ImportStage;
  label: string;
  // The first financial stage committed for a society triggers a pre-import
  // snapshot. Config-only stages (flats, residents, levy defaults) do not.
  financial: boolean;
  targetTable: string;
  naturalKey: string;
  columns: StageColumn[];
}

const OCCUPANCY = ['OWNER', 'TENANT', 'VACANT'] as const;
const BILL_STATUS = ['ISSUED', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
// Import accepts the historical DB modes too — an existing society's books carry
// legacy CASH/CHEQUE/NEFT/IMPS rows that must survive the import verbatim.
const PAYMENT_MODES = [
  'UPI', 'CASH', 'CHEQUE', 'BANK_TRANSFER', 'NEFT', 'IMPS',
  'MANUAL_COLLECTION', 'ADVANCE', 'OTHER',
] as const;
const LEVY_MODES = ['UPI', 'MANUAL_COLLECTION', 'BANK_TRANSFER', 'OTHER'] as const;
const EXPENSE_CATEGORIES = [
  'SECURITY_AGENCY', 'WATCHMAN_SALARY', 'ELECTRICITY', 'WATER_MUNICIPAL', 'GARBAGE',
  'GENERATOR_DIESEL', 'LIFT_CMC', 'LIFT_AMC', 'LIFT_REPAIR', 'PLUMBING', 'ELECTRICAL_REPAIR',
  'CLEANING_SUPPLIES', 'STATIONERY', 'INTERNET', 'MOBILE_RECHARGE', 'BANK_CHARGES',
  'AUDIT', 'LEGAL', 'EVENT', 'ADVANCE_PAYMENT', 'CORPUS_FUND_PAYMENT', 'MISC',
] as const;
const INCOME_CATEGORIES = [
  'MAINTENANCE', 'CMC', 'PENALTY', 'AD_BOARD_INCOME', 'CORPUS_FUND', 'OTHER_INCOME',
] as const;

export const STAGE_DEFS: Record<ImportStage, StageDef> = {
  flats: {
    stage: 'flats', label: 'Flats', financial: false, targetTable: 'units', naturalKey: 'flat_number',
    columns: [
      { key: 'flat_number', label: 'Flat number', required: true, type: 'text', example: 'A-101' },
      { key: 'flat_area_sqft', label: 'Area (sq ft)', required: false, type: 'number', example: '850' },
      { key: 'monthly_amount', label: 'Monthly maintenance', required: false, type: 'number', example: '2500' },
      { key: 'notes', label: 'Notes', required: false, type: 'text', example: '' },
    ],
  },
  residents: {
    stage: 'residents', label: 'Residents', financial: false, targetTable: 'residents', naturalKey: 'flat_number + full_name',
    columns: [
      { key: 'flat_number', label: 'Flat number', required: true, type: 'text', example: 'A-101' },
      { key: 'full_name', label: 'Full name', required: true, type: 'text', example: 'Anita Rao' },
      { key: 'occupancy_type', label: 'Occupancy', required: false, type: 'enum', enumValues: OCCUPANCY, example: 'OWNER' },
      { key: 'phone', label: 'Phone', required: false, type: 'text', example: '9876543210' },
      { key: 'email', label: 'Email', required: false, type: 'text', example: 'anita@example.com' },
      { key: 'is_primary', label: 'Primary contact', required: false, type: 'boolean', example: 'true' },
      { key: 'is_active', label: 'Active', required: false, type: 'boolean', example: 'true' },
    ],
  },
  opening_balances: {
    stage: 'opening_balances', label: 'Opening balances', financial: true, targetTable: 'opening_balances', naturalKey: 'fy_start_year',
    columns: [
      { key: 'fy_start_year', label: 'FY start year', required: true, type: 'integer', example: '2025', help: 'e.g. 2025 for FY 2025-26' },
      { key: 'bank_balance', label: 'Bank balance', required: true, type: 'number', example: '125000' },
      { key: 'cash_in_hand', label: 'Cash in hand', required: true, type: 'number', example: '3500' },
      { key: 'notes', label: 'Notes', required: false, type: 'text', example: '' },
    ],
  },
  levy_configs: {
    stage: 'levy_configs', label: 'AMC yearly amounts', financial: false, targetTable: 'levy_configs', naturalKey: 'levy_label',
    columns: [
      { key: 'levy_label', label: 'AMC year', required: true, type: 'text', example: 'AMC-2025' },
      { key: 'default_amount', label: 'Default amount', required: true, type: 'number', example: '1200' },
    ],
  },
  bills: {
    stage: 'bills', label: 'Bills', financial: true, targetTable: 'bills', naturalKey: 'invoice_number',
    columns: [
      { key: 'flat_number', label: 'Flat number', required: true, type: 'text', example: 'A-101' },
      { key: 'bill_period_year', label: 'Bill year', required: true, type: 'integer', example: '2025' },
      { key: 'bill_period_month', label: 'Bill month (1-12)', required: true, type: 'integer', example: '4' },
      { key: 'invoice_number', label: 'Invoice number', required: false, type: 'text', example: 'INV-0001', help: 'Left blank, a unique HIST- number is assigned.' },
      { key: 'invoice_date', label: 'Invoice date', required: true, type: 'date', example: '2025-04-01' },
      { key: 'due_date', label: 'Due date', required: true, type: 'date', example: '2025-04-10' },
      { key: 'base_amount', label: 'Base amount', required: true, type: 'number', example: '2500' },
      { key: 'previous_due', label: 'Previous due', required: false, type: 'number', example: '0' },
      { key: 'penalty_amount', label: 'Penalty', required: false, type: 'number', example: '0' },
      { key: 'status', label: 'Status', required: false, type: 'enum', enumValues: BILL_STATUS, example: 'ISSUED' },
    ],
  },
  payments: {
    stage: 'payments', label: 'Payments', financial: true, targetTable: 'payments', naturalKey: 'receipt_number',
    columns: [
      { key: 'flat_number', label: 'Flat number', required: true, type: 'text', example: 'A-101' },
      { key: 'amount_paid', label: 'Amount paid', required: true, type: 'number', example: '2500' },
      { key: 'payment_mode', label: 'Payment mode', required: true, type: 'enum', enumValues: PAYMENT_MODES, example: 'UPI' },
      { key: 'payment_date', label: 'Payment date', required: true, type: 'date', example: '2025-04-05' },
      { key: 'receipt_number', label: 'Receipt number', required: false, type: 'text', example: 'REC-0001', help: 'Left blank, a unique HIST- number is assigned.' },
      { key: 'utr_reference', label: 'UTR / reference', required: false, type: 'text', example: '' },
      { key: 'months_detail', label: 'Months covered', required: false, type: 'text', example: 'Apr 2025' },
      { key: 'bill_invoice_numbers', label: 'Allocated invoice numbers', required: false, type: 'text', example: 'INV-0001', help: 'Comma-separated. Must sum to the exact payable total, or leave blank and set unallocated=true.' },
      { key: 'unallocated', label: 'Record without allocation', required: false, type: 'boolean', example: 'false', help: 'true records money without changing any bill status.' },
      { key: 'notes', label: 'Notes', required: false, type: 'text', example: '' },
    ],
  },
  levy_collections: {
    stage: 'levy_collections', label: 'AMC payments', financial: true, targetTable: 'amc_collections', naturalKey: 'flat_number + levy_label + payment_date',
    columns: [
      { key: 'flat_number', label: 'Flat number', required: true, type: 'text', example: 'A-101' },
      { key: 'levy_label', label: 'AMC year', required: true, type: 'text', example: 'AMC-2025' },
      { key: 'amount_paid', label: 'Amount paid', required: true, type: 'number', example: '1200' },
      { key: 'payment_date', label: 'Payment date', required: false, type: 'date', example: '2025-06-01' },
      { key: 'payment_mode', label: 'Payment mode', required: false, type: 'enum', enumValues: LEVY_MODES, example: 'UPI' },
      { key: 'notes', label: 'Notes', required: false, type: 'text', example: '' },
    ],
  },
  expenses: {
    stage: 'expenses', label: 'Expenses', financial: true, targetTable: 'expenditures', naturalKey: 'expense_date + description + amount',
    columns: [
      { key: 'expense_date', label: 'Expense date', required: true, type: 'date', example: '2025-04-15' },
      { key: 'category', label: 'Category', required: true, type: 'enum', enumValues: EXPENSE_CATEGORIES, example: 'ELECTRICITY' },
      { key: 'description', label: 'Description', required: true, type: 'text', example: 'April power bill' },
      { key: 'amount', label: 'Amount', required: true, type: 'number', example: '8200' },
      { key: 'paid_via', label: 'Paid via', required: false, type: 'text', example: 'BANK_TRANSFER' },
      { key: 'payee_name', label: 'Payee', required: false, type: 'text', example: 'BESCOM' },
      { key: 'reference_number', label: 'Reference', required: false, type: 'text', example: '' },
      { key: 'notes', label: 'Notes', required: false, type: 'text', example: '' },
    ],
  },
  other_income: {
    stage: 'other_income', label: 'Other income', financial: true, targetTable: 'other_income', naturalKey: 'income_date + description + amount',
    columns: [
      { key: 'income_date', label: 'Income date', required: true, type: 'date', example: '2025-04-20' },
      { key: 'category', label: 'Category', required: true, type: 'enum', enumValues: INCOME_CATEGORIES, example: 'OTHER_INCOME' },
      { key: 'description', label: 'Description', required: true, type: 'text', example: 'Savings interest' },
      { key: 'amount', label: 'Amount', required: true, type: 'number', example: '450' },
      { key: 'received_via', label: 'Received via', required: false, type: 'text', example: 'BANK_TRANSFER' },
      { key: 'reference_number', label: 'Reference', required: false, type: 'text', example: '' },
      { key: 'notes', label: 'Notes', required: false, type: 'text', example: '' },
    ],
  },
};

export function isImportStage(value: unknown): value is ImportStage {
  return typeof value === 'string' && (IMPORT_STAGES as readonly string[]).includes(value);
}

export function stageDef(stage: ImportStage): StageDef {
  return STAGE_DEFS[stage];
}

// The header row a downloaded template carries. Column keys are the canonical
// names; a treasurer maps their own spreadsheet columns onto these at upload.
export function templateHeader(stage: ImportStage): string[] {
  return STAGE_DEFS[stage].columns.map(c => c.key);
}
