import { z } from 'zod';
import { isWholePaise } from '@/lib/payments/money';

const WHOLE_PAISE_MESSAGE = 'Amount must use at most two decimal places';
const wholePaise = <T extends z.ZodNumber>(schema: T) => schema.refine(isWholePaise, WHOLE_PAISE_MESSAGE);

const nullableMoney = (max: number) => z.number().min(0).max(max).nullable().optional();
const nullableDate = z.string().date().nullable().optional();

export const TreasurerHandoverSchema = z.object({
  handover_date: z.string().date(),
  outgoing_treasurer: z.string().trim().min(2).max(150),
  incoming_treasurer: z.string().trim().min(2).max(150),
  bank_balance: nullableMoney(50_000_000),
  cash_in_hand: nullableMoney(5_000_000),
  outstanding_receivables_note: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export const TreasurerHandoverPatchSchema = TreasurerHandoverSchema.partial().refine(
  value => Object.keys(value).length > 0,
  'Provide a handover change',
);

export const SocietyDocumentSchema = z.object({ title: z.string().trim().min(2).max(160), category: z.enum(['BYLAWS','REGISTRATION','AUDIT_REPORT','AGM_MINUTES','CIRCULAR','FORM','CONTRACT','OTHER']), description: z.string().trim().max(2000).nullable().optional(), document_date: nullableDate, published_to_residents: z.boolean().default(false) });
export const SocietyDocumentPatchSchema = SocietyDocumentSchema.partial().extend({ archive: z.literal(true).optional() }).refine(v => Object.keys(v).length > 0);
export const VendorSchema = z.object({ name: z.string().trim().min(2).max(160), service_category: z.string().trim().min(2).max(100), contact_name: z.string().trim().max(150).nullable().optional(), phone: z.string().trim().regex(/^[0-9+ ()-]{7,20}$/).nullable().optional(), email: z.string().trim().email().max(254).nullable().optional(), address: z.string().trim().max(500).nullable().optional(), notes: z.string().trim().max(2000).nullable().optional() });
export const VendorPatchSchema = VendorSchema.partial().extend({ archive: z.literal(true).optional() }).refine(v => Object.keys(v).length > 0);
const VendorContractFields = z.object({ vendor_id: z.string().uuid(), title: z.string().trim().min(2).max(160), contract_value: nullableMoney(50_000_000), start_date: nullableDate, end_date: nullableDate, renewal_notice_days: z.number().int().min(0).max(365).default(30), status: z.enum(['DRAFT','ACTIVE','EXPIRED','TERMINATED']).default('ACTIVE'), notes: z.string().trim().max(2000).nullable().optional() });
export const VendorContractSchema = VendorContractFields.refine(v => !v.start_date || !v.end_date || v.end_date >= v.start_date, { path: ['end_date'], message: 'End date must not precede start date' });
export const VendorContractPatchSchema = VendorContractFields.partial().extend({ archive: z.literal(true).optional() }).refine(v => Object.keys(v).length > 0).refine(v => !v.start_date || !v.end_date || v.end_date >= v.start_date, { path: ['end_date'], message: 'End date must not precede start date' });
export const AssetSchema = z.object({ vendor_id: z.string().uuid().nullable().optional(), name: z.string().trim().min(2).max(160), category: z.string().trim().min(2).max(100), location: z.string().trim().max(200).nullable().optional(), purchase_date: nullableDate, warranty_expires_on: nullableDate, next_service_date: nullableDate, status: z.enum(['ACTIVE','UNDER_REPAIR','OUT_OF_SERVICE','RETIRED']).default('ACTIVE'), notes: z.string().trim().max(2000).nullable().optional() });
export const AssetPatchSchema = AssetSchema.partial().extend({ archive: z.literal(true).optional() }).refine(v => Object.keys(v).length > 0);
const AssetServiceFields = z.object({ asset_id: z.string().uuid(), vendor_id: z.string().uuid().nullable().optional(), service_date: z.string().date(), next_service_date: nullableDate, description: z.string().trim().min(2).max(1000), amount: nullableMoney(50_000_000), notes: z.string().trim().max(2000).nullable().optional() });
export const AssetServiceRecordSchema = AssetServiceFields.refine(v => !v.next_service_date || v.next_service_date >= v.service_date, { path: ['next_service_date'], message: 'Next service date must not precede service date' });
export const AssetServiceRecordPatchSchema = AssetServiceFields.partial().extend({ archive: z.literal(true).optional() }).refine(v => Object.keys(v).length > 0).refine(v => !v.service_date || !v.next_service_date || v.next_service_date >= v.service_date, { path: ['next_service_date'], message: 'Next service date must not precede service date' });
export const OperationalExpenseLinkSchema = z.object({ expenditure_id: z.string().uuid(), vendor_contract_id: z.string().uuid().nullable().optional(), asset_id: z.string().uuid().nullable().optional(), asset_service_record_id: z.string().uuid().nullable().optional() }).refine(v => [v.vendor_contract_id, v.asset_id, v.asset_service_record_id].filter(Boolean).length === 1, 'Choose exactly one operational record');
export const OperationsArchiveSchema = z.object({ archive: z.literal(true) });
const NoticeFields = z.object({ title: z.string().trim().min(2).max(160), body: z.string().trim().min(2).max(10_000), published_at: z.string().datetime().optional(), expires_at: z.string().datetime().nullable().optional(), category: z.enum(['GENERAL','MAINTENANCE','SAFETY','EVENT','FINANCE','GOVERNANCE']).default('GENERAL'), audience: z.enum(['ALL_MEMBERS','RESIDENTS','OPERATORS']).default('ALL_MEMBERS'), is_pinned: z.boolean().default(false) });
export const NoticeCreateSchema = NoticeFields.refine(v => !v.published_at || !v.expires_at || v.expires_at > v.published_at, { path: ['expires_at'], message: 'Expiry must be after publication' });
export const NoticePatchSchema = NoticeFields.partial().extend({ archive: z.literal(true).optional() }).refine(v => Object.keys(v).length > 0, 'Provide a notice change').refine(v => !v.published_at || !v.expires_at || v.expires_at > v.published_at, { path: ['expires_at'], message: 'Expiry must be after publication' });

export const PaymentSchema = z.object({
  unit_id:           z.string().uuid('Invalid flat ID'),
  // preprocess (not z.coerce.number()) so a genuinely missing field still hits
  // required_error instead of coercion turning `undefined` into NaN first —
  // coerce only kicks in for actual strings (e.g. a non-JS API caller).
  amount_paid:       z.preprocess(
                        (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
                        wholePaise(z.number({ error: 'Amount is required' })
                          .positive('Amount must be positive')
                          .max(500_000, 'Amount too large — check for typos')),
                      ),
  payment_mode:      z.enum([
                       'UPI','MANUAL_COLLECTION','BANK_TRANSFER','OTHER'
                     ]),
  payment_date:      z.string().date('Invalid date'),
  payment_time:      z.string().optional(),
  utr_reference:     z.string().max(100).optional(),
  collector_name:    z.string().max(100).optional(),
  months_covered:    z.number().int().min(1).max(24).default(1),
  months_detail:     z.string().max(200).optional(),
  notes:             z.string().max(500).optional(),
  resident_id:       z.string().uuid().optional(),
  bill_ids:          z.array(z.string().uuid()).optional(),
});

export const ExpenseSchema = z.object({
  expense_date:      z.string().date(),
  category:          z.enum([
                       'SECURITY_AGENCY','WATCHMAN_SALARY','ELECTRICITY',
                       'WATER_MUNICIPAL','GARBAGE','GENERATOR_DIESEL',
                       'LIFT_CMC','LIFT_AMC','LIFT_REPAIR','PLUMBING',
                       'ELECTRICAL_REPAIR','CLEANING_SUPPLIES','STATIONERY',
                       'INTERNET','MOBILE_RECHARGE','BANK_CHARGES','AUDIT',
                       'LEGAL','EVENT','ADVANCE_PAYMENT','CORPUS_FUND_PAYMENT','MISC'
                     ]),
  description:       z.string().min(2).max(300),
  amount:            z.number().positive().max(500_000),
  paid_via:          z.string().max(50).optional(),
  payee_name:        z.string().max(150).optional(),
  reference_number:  z.string().max(100).optional(),
  notes:             z.string().max(500).optional(),
});

export const VoidSchema = z.object({
  id:          z.string().uuid(),
  void_reason: z.string().min(10, 'Please give a clear reason (min 10 chars)').max(500),
});

export const ResidentSchema = z.object({
  unit_id:              z.string().uuid(),
  full_name:            z.string().min(2).max(150),
  occupancy_type:       z.enum(['OWNER','TENANT','VACANT']),
  phone:                z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number').optional().or(z.literal('')),
  email:                z.string().email().optional().or(z.literal('')),
  notification_channel: z.enum(['EMAIL','WHATSAPP','NONE']).default('EMAIL'),
  is_primary:           z.boolean().default(true),
  move_in_date:         z.string().date().optional(),
  move_out_date:        z.string().date().optional().nullable(),
  is_active:            z.boolean().optional(),
  notes:                z.string().max(300).optional(),
  consent_given:        z.boolean().default(false),
});

export const BillGenerateSchema = z.object({
  bill_period_year:   z.number().int().min(2020).max(2040),
  bill_period_month:  z.number().int().min(1).max(12),
  unit_ids:           z.array(z.string().uuid()).optional(),
  cgst_percent:       z.number().min(0).max(28).default(0),
  sgst_percent:       z.number().min(0).max(28).default(0),
  previous_due:       z.number().min(0).default(0),
  penalty_amount:     z.number().min(0).default(0),
  notes:              z.string().max(500).optional(),
});

export const BalanceSnapshotSchema = z.object({
  snapshot_date: z.string().date(),
  bank_balance:  z.number().min(0).max(50_000_000, 'Amount seems too large — check for typos'),
  cash_in_hand:  z.number().min(0).max(5_000_000,  'Amount seems too large — check for typos'),
  notes:         z.string().max(500).optional(),
});


export const OpeningBalanceSchema = z.object({
  fy_start_year: z.number().int().min(2020).max(2100),
  bank_balance:  z.number().min(0).max(50_000_000, 'Amount seems too large — check for typos'),
  cash_in_hand:  z.number().min(0).max(5_000_000,  'Amount seems too large — check for typos'),
  notes:         z.string().max(500).optional(),
});


export const FundLedgerEntrySchema = z.object({
  fund_type:  z.enum(['CORPUS', 'SINKING']),
  entry_type: z.enum(['CONTRIBUTION', 'INTEREST', 'OUTFLOW']),
  amount:     z.number().positive('Amount must be positive').max(10_000_000, 'Amount seems too large — check for typos'),
  entry_date: z.string().date(),
  notes:      z.string().max(500).optional(),
});


export const AdvanceSettlementSchema = z.object({
  advance_kind:    z.enum(['PAYMENT', 'EXPENSE']),
  advance_id:      z.string().uuid(),
  settled_amount:  wholePaise(z.number().positive('Amount must be positive').max(500_000, 'Amount seems too large — check for typos')),
  settled_against: z.string().min(3, 'Describe what this was applied against').max(300),
  settled_date:    z.string().date(),
  notes:           z.string().max(500).optional(),
});

export const LegacyAdvanceReconciliationSchema = z.object({
  settlement_id: z.string().uuid(),
  bill_id: z.string().uuid().optional(),
  historical_note: z.string().trim().min(10).max(500).optional(),
}).refine(value => Boolean(value.bill_id) !== Boolean(value.historical_note), {
  message: 'Choose a bill or explain why this is historical',
});

export const UnitMonthlyAmountSchema = z.object({
  unit_id: z.string().uuid(),
  monthly_amount: z.number().min(0).max(1_000_000).nullable(),
});

export const FinancialSetupSchema = z.object({
  monthly_maintenance_amount: z.number().min(0).max(1_000_000),
  maintenance_payment_window_days: z.number().int().min(0).max(365),
  penalty_rate_percent: z.number().min(0).max(100),
  bank_name: z.string().trim().max(150).nullable(),
  bank_account_no: z.string().trim().max(50).nullable(),
  bank_ifsc: z.string().trim().max(20).nullable(),
  upi_id: z.string().trim().max(100).nullable(),
  dues_notice_title: z.string().trim().min(2).max(160),
  dues_notice_payby_days: z.number().int().min(0).max(365),
  dues_notice_footer: z.string().trim().max(2000),
});


export const BankStatementUploadSchema = z.object({
  filename: z.string().max(255).optional(),
  csv_text: z.string().min(1, 'CSV file is empty').max(2_000_000, 'CSV file too large'),
});

export const BankStatementLineActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('match'),
    matched_table: z.enum(['payments', 'amc_collections', 'other_income', 'expenditures']),
    matched_id: z.string().uuid(),
  }),
  z.object({ action: z.literal('ignore') }),
  z.object({ action: z.literal('unmatch') }),
]);

export const OtherIncomeSchema = z.object({
  income_date:      z.string().date(),
  category:         z.enum(['MAINTENANCE','CMC','PENALTY','AD_BOARD_INCOME','CORPUS_FUND','OTHER_INCOME']),
  description:      z.string().min(2).max(300),
  amount:           z.number().positive().max(500_000),
  received_via:     z.string().max(50).optional(),
  reference_number: z.string().max(100).optional(),
  notes:            z.string().max(500).optional(),
});

const PAYMENT_MODES = ['UPI','MANUAL_COLLECTION','BANK_TRANSFER','OTHER'] as const;

/** Financial levy labels are printable, single-line, free-text identifiers. */
export const LEVY_LABEL_PATTERN = /^[\p{L}\p{N} .,'()\-/&]{2,60}$/u;
const LEVY_LABEL_MESSAGE = 'Choose a valid AMC year.';
const AMC_YEAR_PATTERN = /^AMC-20[0-9]{2}$/;
const AMC_YEAR_MESSAGE = 'Use AMC followed by a four-digit year, for example AMC-2027.';

export const LevySchema = z.object({
  unit_id:      z.string().uuid('Invalid unit ID'),
  resident_id:  z.string().uuid().optional(),
  levy_label:   z.string().trim().regex(LEVY_LABEL_PATTERN, LEVY_LABEL_MESSAGE),
  amount_paid:  wholePaise(z.number().positive('Amount must be positive').max(50_000)),
  payment_date: z.string().date().optional(),
  payment_mode: z.enum(PAYMENT_MODES).default('MANUAL_COLLECTION'),
  notes:        z.string().max(300).optional(),
});

export const LevyPatchSchema = z.object({
  amount_paid:  wholePaise(z.number().positive().max(50_000)),
  payment_date: z.string().date().optional().nullable(),
  payment_mode: z.enum(PAYMENT_MODES).optional(),
  notes:        z.string().max(300).optional().nullable(),
});

export const LevyConfigSchema = z.object({
  levy_label:     z.string().trim().regex(AMC_YEAR_PATTERN, AMC_YEAR_MESSAGE),
  default_amount: wholePaise(z.number().min(0, 'Amount must be 0 or more').max(1_000_000, 'Amount too large')),
});

export const LevyConfigPatchSchema = z.object({
  default_amount: wholePaise(z.number().min(0).max(1_000_000)),
});

// Treasurer-triggered committee summary email. Recipients are typed at
// send time, not persisted — no distribution-list table exists yet (adding
export const CommitteeEmailSchema = z.object({
  to: z.array(z.string().email('Invalid email address')).min(1, 'At least one recipient is required').max(20),
});

// account yet). society_id + unit_id are validated against real rows in the API.
export const AccessRequestSchema = z.object({
  society_id: z.string().uuid('Please pick your society'),
  unit_id:    z.string().uuid('Please pick your flat'),
  email:      z.string().email('Enter a valid email'),
  name:       z.string().max(150).optional(),
  phone:      z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number').optional().or(z.literal('')),
});

export const AccessRequestDecisionSchema = z.object({
  action: z.enum(['approve', 'decline']),
  reason: z.string().max(300).optional(),
});

const SocietyUnitSchema = z.object({
  flat_number: z.string().trim().min(1).max(30),
  flat_area_sqft: z.number().positive().max(1_000_000).optional(),
  monthly_amount: z.number().nonnegative().max(1_000_000).optional(),
});

export const CreateSocietySchema = z.object({
  name: z.string().trim().min(2).max(150),
  short_name: z.string().trim().min(2).max(20).optional().or(z.literal('')),
  slug: z.string().trim().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, 'Use 3–48 lowercase letters, numbers, or hyphens'),
  address: z.string().trim().max(500).optional(),
  primary_contact_name: z.string().trim().max(150).optional(),
  contact_phone: z.string().trim().max(30).optional(),
  contact_email: z.string().email().optional().or(z.literal('')),
  bank_name: z.string().trim().max(150).optional(),
  bank_account_no: z.string().trim().max(50).optional(),
  bank_ifsc: z.string().trim().max(20).optional(),
  upi_id: z.string().trim().max(100).optional(),
  receipt_prefix: z.string().trim().regex(/^[A-Za-z0-9-]{2,20}$/),
  monthly_maintenance_amount: z.number().nonnegative().max(1_000_000),
  maintenance_payment_window_days: z.number().int().min(1).max(365),
  penalty_rate_percent: z.number().min(0).max(100),
  units: z.array(SocietyUnitSchema).min(1).max(2_000).superRefine((units, ctx) => {
    const seen = new Set<string>();
    units.forEach((unit, index) => {
      const normalized = unit.flat_number.toLocaleLowerCase('en-IN');
      if (seen.has(normalized)) ctx.addIssue({ code: 'custom', path: [index, 'flat_number'], message: 'Duplicate flat number' });
      seen.add(normalized);
    });
  }),
  initial_admin_emails: z.array(z.string().email()).max(20).default([]),
});

export const SocietySuspensionSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});

export const PlatformAdminAuthorizationSchema = z.object({
  email: z.string().trim().email(),
});

export type LevyConfigInput      = z.infer<typeof LevyConfigSchema>;
export type LevyConfigPatchInput = z.infer<typeof LevyConfigPatchSchema>;
export type PaymentInput        = z.infer<typeof PaymentSchema>;
export type ExpenseInput        = z.infer<typeof ExpenseSchema>;
export type ResidentInput       = z.infer<typeof ResidentSchema>;
export type BillGenerateInput   = z.infer<typeof BillGenerateSchema>;
export type BalanceSnapshotInput   = z.infer<typeof BalanceSnapshotSchema>;
export type OpeningBalanceInput    = z.infer<typeof OpeningBalanceSchema>;
export type FundLedgerEntryInput   = z.infer<typeof FundLedgerEntrySchema>;
export type AdvanceSettlementInput = z.infer<typeof AdvanceSettlementSchema>;
export type LegacyAdvanceReconciliationInput = z.infer<typeof LegacyAdvanceReconciliationSchema>;
export type UnitMonthlyAmountInput = z.infer<typeof UnitMonthlyAmountSchema>;
export type FinancialSetupInput = z.infer<typeof FinancialSetupSchema>;
export type BankStatementUploadInput = z.infer<typeof BankStatementUploadSchema>;
export type BankStatementLineActionInput = z.infer<typeof BankStatementLineActionSchema>;
export type OtherIncomeInput    = z.infer<typeof OtherIncomeSchema>;
export type LevyInput           = z.infer<typeof LevySchema>;
export type LevyPatchInput      = z.infer<typeof LevyPatchSchema>;
export type CommitteeEmailInput = z.infer<typeof CommitteeEmailSchema>;
export type AccessRequestInput = z.infer<typeof AccessRequestSchema>;
export type CreateSocietyInput = z.infer<typeof CreateSocietySchema>;
