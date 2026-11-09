export type PaymentMode =
  | 'UPI' | 'CASH' | 'MANUAL_COLLECTION'
  | 'BANK_TRANSFER' | 'NEFT' | 'IMPS' | 'CHEQUE' | 'ADVANCE' | 'OTHER';

export type PaymentStatus = 'PAID' | 'DUE' | 'PARTIAL' | 'ADVANCE' | 'WAIVED';
export type BillStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type ExpenseCategory =
  | 'SECURITY_AGENCY' | 'WATCHMAN_SALARY' | 'ELECTRICITY' | 'WATER_MUNICIPAL'
  | 'GARBAGE' | 'GENERATOR_DIESEL' | 'LIFT_CMC' | 'LIFT_AMC' | 'LIFT_REPAIR'
  | 'PLUMBING' | 'ELECTRICAL_REPAIR' | 'CLEANING_SUPPLIES' | 'STATIONERY'
  | 'INTERNET' | 'MOBILE_RECHARGE' | 'BANK_CHARGES' | 'AUDIT' | 'LEGAL'
  | 'EVENT' | 'ADVANCE_PAYMENT' | 'CORPUS_FUND_PAYMENT' | 'MISC';
export type IncomeCategory =
  | 'MAINTENANCE' | 'CMC' | 'PENALTY' | 'AD_BOARD_INCOME' | 'CORPUS_FUND' | 'OTHER_INCOME';
export type OccupancyType = 'OWNER' | 'TENANT' | 'VACANT';
export type AppRole = 'admin' | 'treasurer' | 'resident' | 'committee' | 'auditor';
export type PlatformRole = 'platform_owner';
export type SocietyStatus = 'active' | 'suspended';
export type MembershipStatus = 'active' | 'revoked';
export type NotificationChannel = 'EMAIL' | 'WHATSAPP' | 'NONE';
export type AuditAction =
  | 'INSERT' | 'UPDATE' | 'SOFT_DELETE' | 'EXPORT'
  | 'LOGIN' | 'LOGOUT' | 'RECEIPT_GENERATED' | 'BILL_GENERATED';

export type SocietyConfig = {
  id: string;
  society_id: string;
  name: string;
  registration_number: string | null;
  address: string | null;
  mobile: string | null;
  pan_number: string | null;
  gstin: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
  upi_qr_object_key: string | null;
  logo_url: string | null;
  receipt_prefix: string;
  next_receipt_no: number;
  monthly_maintenance_amount: number;
  penalty_rate_percent: number | null;
  maintenance_payment_window_days: number;
  financial_year_start_month: number;
  dues_notice_title: string;
  dues_notice_payby_days: number;
  dues_notice_footer: string;
  // Migration 062 — durable assistant budget (opt-in per society).
  agent_enabled: boolean;
  agent_daily_user_limit: number;
  agent_daily_society_limit: number;
  created_at: string;
  updated_at: string;
};

// Migration 062 — atomic per-day usage counters (assistant quota).
export type UsageCounter = {
  counter_type: 'agent_user' | 'agent_society' | 'agent_deployment';
  scope_id: string;
  period_date: string;
  count: number;
  society_id: string | null;
  updated_at: string;
};

// Migration 062 — latest per-society capacity/backup measurement.
export type SocietyUsageCurrent = {
  society_id: string;
  measured_at: string;
  db_row_count: number;
  artifact_bytes: number;
  snapshot_bytes: number;
  snapshot_count: number;
  last_snapshot_at: string | null;
  last_snapshot_result: 'UPLOADED' | 'SKIPPED_UNCHANGED' | 'FAILED' | null;
  last_snapshot_ratio: number | null;
  last_snapshot_hash: string | null;
};

export type Unit = {
  id: string;
  flat_number: string;
  flat_area_sqft: number | null;
  monthly_amount: number | null;
  notes: string | null;
  is_active: boolean;
  is_test_unit: boolean;
  created_at: string;
  updated_at: string;
  // Canonical tenant boundary; required since migration 030.
  society_id: string;
};

export type Society = {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  address: string | null;
  primary_contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  upi_vpa: string | null;
  fy_start_month: number | null;
  status: SocietyStatus;
  is_active: boolean;
  suspended_at: string | null;
  suspended_by: string | null;
    suspension_reason: string | null;
    legacy_storage_layout: 'unscoped-v1' | null;
    created_at: string;
};

export type PlatformOwner = {
  user_id: string;
  created_at: string;
};

export type SocietyMembership = {
  id: string;
  user_id: string;
  society_id: string;
  role: AppRole;
  unit_id: string | null;
  status: MembershipStatus;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
  updated_at: string;
};

// Migration 034 — resident self-onboarding request queue.
export type AccessRequest = {
  id: string;
  society_id: string;
  email: string;
  unit_id: string;
  submitted_name: string | null;
  submitted_phone: string | null;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  decline_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export type SocietyNotice = {
  id: string;
  society_id: string;
  title: string;
  body: string;
  published_at: string;
  expires_at: string | null;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  category: NoticeCategory;
  audience: NoticeAudience;
  is_pinned: boolean;
};

export type NoticeCategory = 'GENERAL' | 'MAINTENANCE' | 'SAFETY' | 'EVENT' | 'FINANCE' | 'GOVERNANCE';
export type NoticeAudience = 'ALL_MEMBERS' | 'RESIDENTS' | 'OPERATORS';
export type DocumentCategory = 'BYLAWS' | 'REGISTRATION' | 'AUDIT_REPORT' | 'AGM_MINUTES' | 'CIRCULAR' | 'FORM' | 'CONTRACT' | 'OTHER';
export type ContractStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED';
export type AssetStatus = 'ACTIVE' | 'UNDER_REPAIR' | 'OUT_OF_SERVICE' | 'RETIRED';

export type SocietyDocument = { id: string; society_id: string; title: string; category: DocumentCategory; description: string | null; document_date: string | null; published_to_residents: boolean; archived_at: string | null; created_by: string; created_at: string; updated_at: string };
export type Vendor = { id: string; society_id: string; name: string; service_category: string; contact_name: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null; archived_at: string | null; created_by: string; created_at: string; updated_at: string };
export type VendorContract = { id: string; society_id: string; vendor_id: string; title: string; contract_value: number | null; start_date: string | null; end_date: string | null; renewal_notice_days: number; status: ContractStatus; notes: string | null; archived_at: string | null; created_by: string; created_at: string; updated_at: string };
export type Asset = { id: string; society_id: string; vendor_id: string | null; name: string; category: string; location: string | null; purchase_date: string | null; warranty_expires_on: string | null; next_service_date: string | null; status: AssetStatus; notes: string | null; archived_at: string | null; created_by: string; created_at: string; updated_at: string };
export type AssetServiceRecord = { id: string; society_id: string; asset_id: string; vendor_id: string | null; service_date: string; next_service_date: string | null; description: string; amount: number | null; notes: string | null; archived_at: string | null; created_by: string; created_at: string; updated_at: string };
export type OperationalExpenseLink = { id: string; society_id: string; expenditure_id: string; vendor_contract_id: string | null; asset_id: string | null; asset_service_record_id: string | null; created_by: string; created_at: string; archived_at: string | null };
export type SocietyAttachment = { id: string; society_id: string; document_id: string | null; vendor_contract_id: string | null; asset_id: string | null; asset_service_record_id: string | null; notice_id: string | null; filename: string; content_type: 'application/pdf' | 'image/jpeg' | 'image/png'; byte_size: number; sha256: string; object_key: string; created_by: string; created_at: string; archived_at: string | null };

export type Resident = {
  id: string;
  society_id: string;
  unit_id: string;
  full_name: string;
  occupancy_type: OccupancyType;
  phone: string | null;
  email: string | null;
  notification_channel: NotificationChannel;
  consent_given: boolean;
  consent_date: string | null;
  is_primary: boolean;
  move_in_date: string | null;
  move_out_date: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Payment = {
  id: string;
  unit_id: string;
  resident_id: string | null;
  bill_ids: string[];
  amount_paid: number;
  payment_mode: PaymentMode;
  payment_date: string;
  payment_time: string | null;
  payment_timestamp: string | null;
  utr_reference: string | null;
  collector_name: string | null;
  months_covered: number;
  months_detail: string | null;
  notes: string | null;
  // Migration 066. Portion of amount_paid not yet applied to any bill;
  // applied + unapplied = amount_paid. Keeps payment_mode truthful about HOW the
  // money arrived while tracking separately how much of it is allocated.
  unapplied_amount: number;
  // Migration 072. True only when the unapplied balance is undirected account
  // credit that may automatically pay this unit's oldest eligible bill.
  auto_apply_credit: boolean;
  // FY treasurer responsible on the payment date.
  recorded_by: string | null;
  // Added by migration 030 (multi-tenancy). Optional until type regen lands.
  society_id: string;
  payment_status: PaymentStatus;
  is_voided: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  receipt_number: string | null;
  receipt_generated_at: string | null;
  receipt_pdf_url: string | null;
  row_hash: string | null;
  // Set by confirm_resident_payment() (migration 058) for Razorpay-confirmed
  // online payments; NULL for every manually recorded or historical payment.
  gateway_payment_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Bill = {
  id: string;
  society_id: string;
  unit_id: string;
  bill_period_year: number;
  bill_period_month: number;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  base_amount: number;
  cgst_percent: number;
  sgst_percent: number;
  cgst_amount: number;
  sgst_amount: number;
  total_amount: number;
  previous_due: number;
  penalty_amount: number;
  cheque_dishonour: number;
  payable_amount: number;
  // Migration 066. Cumulative amount applied to this bill. status becomes PAID
  // when amount_settled >= payable_amount. Exists so a bill can be partially
  // settled, which oldest-first appropriation requires.
  amount_settled: number;
  status: BillStatus;
  notes: string | null;
  is_voided: boolean;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Expenditure = {
  id: string;
  society_id: string;
  expense_date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paid_via: string | null;
  payee_name: string | null;
  reference_number: string | null;
  bill_attachment_url: string | null;
  // FY treasurer responsible on the expense date.
  recorded_by: string | null;
  notes: string | null;
  is_voided: boolean;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OtherIncome = {
  id: string;
  society_id: string;
  income_date: string;
  category: IncomeCategory;
  description: string;
  amount: number;
  received_via: string | null;
  reference_number: string | null;
  recorded_by: string | null;
  notes: string | null;
  is_voided: boolean;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  society_id: string;
  role: AppRole;
  unit_id: string | null;
  created_at: string;
};

export type ResidentInvite = {
  id: string;
  email: string;
  role: AppRole;
  unit_id: string | null;
  invited_by: string;
  created_at: string;
  claimed_at: string | null;
  claimed_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  // Added by migration 030 (multi-tenancy).
  society_id: string;
};

export type AuditLog = {
  id: number;
  society_id: string | null;
  action: AuditAction;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  performed_by: string;
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  notes: string | null;
  created_at: string;
};

export type BalanceSnapshot = {
  id: string;
  society_id: string;
  snapshot_date: string;
  bank_balance: number | null;
  cash_in_hand: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type LevyConfig = {
  id: string;
  society_id: string;
  levy_label: string;
  default_amount: number;
  is_active_for_new_collections: boolean;
  created_at: string;
};

export type LevyAssessmentStatus = 'PENDING' | 'PAID';

// Migration 067. The per-unit obligation row a levy_configs default amount
// never carried: one row per (society, unit, levy_label) while NOT is_voided.
export type LevyAssessment = {
  id: string;
  society_id: string;
  unit_id: string;
  levy_label: string;
  amount: number;
  amount_settled: number;
  status: LevyAssessmentStatus;
  is_voided: boolean;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AmcCollection = {
    id: string;
    society_id: string;
    unit_id: string;
  resident_id: string | null;
  levy_label: string;
  amount_paid: number;
  payment_date: string | null;
  payment_mode: string;
  notes: string | null;
  pdf_url: string | null;
  // FY treasurer responsible on the levy payment date.
  recorded_by: string | null;
  is_voided: boolean;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
};

export type FyTreasurer = {
  id: string;
  society_id: string;
  fy_start_year: number;
  resident_id: string;
  created_at: string;
  updated_at: string;
};

export type TreasurerHandover = {
  id: string;
  society_id: string;
  handover_date: string;
  outgoing_treasurer: string;
  incoming_treasurer: string;
  bank_balance: number | null;
  cash_in_hand: number | null;
  outstanding_receivables_note: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};


export type OpeningBalance = {
  id: string;
  society_id: string;
  fy_start_year: number;
  bank_balance: number;
  cash_in_hand: number;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FundType = 'CORPUS' | 'SINKING';
export type FundEntryType = 'CONTRIBUTION' | 'INTEREST' | 'OUTFLOW';

export type FundLedgerEntry = {
  id: string;
  society_id: string;
  fund_type: FundType;
  entry_type: FundEntryType;
  amount: number;
  entry_date: string;
  source_table: 'other_income' | 'expenditures' | null;
  source_id: string | null;
  notes: string | null;
  is_voided: boolean;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
};

export type AdvanceKind = 'PAYMENT' | 'EXPENSE';

export type AdvanceSettlement = {
  id: string;
  society_id: string;
  advance_kind: AdvanceKind;
  advance_id: string;
  settled_amount: number;
  settled_against: string;
  settled_date: string;
  notes: string | null;
  // Migration 066. The bill this settlement actually pays. NULL on rows
  // predating 066 and on EXPENSE-kind settlements.
  bill_id: string | null;
  // Migration 073. The levy assessment paid by this allocation; mutually
  // exclusive with bill_id and NULL on legacy/note-only settlements.
  levy_assessment_id: string | null;
  // Migration 068. Pre-066 PAYMENT settlements either gain a bill_id through
  // reconciliation or are explicitly acknowledged as historical/unlinked.
  legacy_resolution: 'LINKED' | 'HISTORICAL_UNLINKED' | null;
  legacy_reconciled_at: string | null;
  legacy_reconciled_by: string | null;
  legacy_resolution_note: string | null;
  is_voided: boolean;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
};

export type BankStatementBatch = {
  id: string;
  society_id: string;
  filename: string | null;
  statement_from: string | null;
  statement_to: string | null;
  line_count: number;
  uploaded_by: string | null;
  uploaded_at: string;
};

export type BankStatementLine = {
  id: string;
  batch_id: string;
  line_date: string;
  description: string;
  amount: number;
  reference: string | null;
  matched_table: 'payments' | 'amc_collections' | 'other_income' | 'expenditures' | null;
  matched_id: string | null;
  matched_at: string | null;
  matched_by: string | null;
  is_ignored: boolean;
  created_at: string;
};

export type ResidentPaymentLinkStatus = 'created' | 'paid' | 'cancelled' | 'expired';

export type ResidentPaymentLink = {
  id: string;
  society_id: string;
  unit_id: string;
  bill_ids: string[];
  amount: number;
  razorpay_link_id: string;
  short_url: string;
  status: ResidentPaymentLinkStatus;
  razorpay_payment_id: string | null;
  payment_id: string | null;
  created_by: string | null;
  created_at: string;
  paid_at: string | null;
  reconciliation_required: boolean;
  reconciliation_note: string | null;
  // Migration 073. New resident gateway links feed the whole-account bucket;
  // old bill-directed links remain strict for webhook compatibility.
  auto_apply_credit: boolean;
};

// 'retracted' (migration 066) is a terminal state a resident sets on their own
// pending claim. Distinct from 'rejected', which is an operator decision.
export type ResidentPaymentClaimStatus = 'pending' | 'approved' | 'rejected' | 'retracted';

export type ResidentPaymentClaim = {
  id: string;
  society_id: string;
  unit_id: string;
  bill_ids: string[];
  // Migration 067. A claim carries bills OR levy assessments, never both
  // (resident_payment_claims_bill_xor_levy). Empty for a bill (or advance)
  // claim.
  levy_assessment_ids: string[];
  amount: number;
  utr_reference: string | null;
  paid_on: string | null;
  screenshot_object_key: string;
  status: ResidentPaymentClaimStatus;
  payment_id: string | null;
  // Migration 067. The amc_collections row created on approval of a levy
  // claim — the levy path's equivalent of payment_id. NULL for a bill claim.
  levy_collection_id: string | null;
  review_note: string | null;
  submitted_by: string | null;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

export type PushSubscription = {
  id: string;
  user_id: string;
  society_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
};

// Migration 063 — staged society import.
export type ImportStageName =
  | 'flats' | 'residents' | 'opening_balances' | 'levy_configs'
  | 'bills' | 'payments' | 'levy_collections' | 'expenses' | 'other_income';
export type ImportBatchStatus = 'UPLOADED' | 'VALIDATED' | 'COMMITTED' | 'FAILED' | 'CANCELLED';

export type SocietyImportBatch = {
  id: string;
  society_id: string;
  stage: ImportStageName;
  status: ImportBatchStatus;
  object_key: string;
  sha256: string;
  row_count: number;
  valid_count: number;
  error_count: number;
  validation_summary: Record<string, unknown> | null;
  committed_ids: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  validated_at: string | null;
  committed_at: string | null;
  updated_at: string;
};

export type SocietyImportRecord = {
  id: string;
  batch_id: string;
  row_number: number;
  raw: Record<string, unknown>;
  status: 'ERROR' | 'DUPLICATE_SKIP';
  errors: Array<{ column: string; message: string }> | null;
  created_at: string;
};

export type DuesSummary = {
  society_id: string;
  flat_number: string;
  primary_resident: string | null;
  phone: string | null;
  email: string | null;
  unpaid_months: number;
  unpaid_levies: number;
  maintenance_due: number;
  levy_due: number;
  total_due: number;
  last_paid_date: string | null;
};

// Joined types for UI
export type PaymentWithUnit = Payment & {
  units?: { flat_number: string } | null;
  residents?: { full_name: string } | null;
};

export type BillWithUnit = Bill & {
  units?: { flat_number: string } | null;
};

type Rels = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
}[];

export type Database = {
  public: {
    Tables: {
      society_config:    { Row: SocietyConfig;    Insert: Partial<SocietyConfig>;    Update: Partial<SocietyConfig>;    Relationships: Rels };
      units:             { Row: Unit;             Insert: Partial<Unit>;             Update: Partial<Unit>;             Relationships: Rels };
      residents:         { Row: Resident;         Insert: Partial<Resident>;         Update: Partial<Resident>;         Relationships: Rels };
      payments:          { Row: Payment;          Insert: Partial<Payment>;          Update: Partial<Payment>;          Relationships: Rels };
      bills:             { Row: Bill;             Insert: Partial<Bill>;             Update: Partial<Bill>;             Relationships: Rels };
      expenditures:      { Row: Expenditure;      Insert: Partial<Expenditure>;      Update: Partial<Expenditure>;      Relationships: Rels };
      other_income:      { Row: OtherIncome;      Insert: Partial<OtherIncome>;      Update: Partial<OtherIncome>;      Relationships: Rels };
      audit_log:         { Row: AuditLog;         Insert: Partial<AuditLog>;         Update: Partial<AuditLog>;         Relationships: Rels };
      balance_snapshots:    { Row: BalanceSnapshot;    Insert: Partial<BalanceSnapshot>;    Update: Partial<BalanceSnapshot>;    Relationships: Rels };
      amc_collections:      { Row: AmcCollection;      Insert: Partial<AmcCollection>;      Update: Partial<AmcCollection>;      Relationships: Rels };
      treasurer_handovers:  { Row: TreasurerHandover;  Insert: Partial<TreasurerHandover>;  Update: Partial<TreasurerHandover>;  Relationships: Rels };
      fy_treasurers:        { Row: FyTreasurer;        Insert: Partial<FyTreasurer>;        Update: Partial<FyTreasurer>;        Relationships: Rels };
      levy_configs:         { Row: LevyConfig;         Insert: Partial<LevyConfig>;         Update: Partial<LevyConfig>;         Relationships: Rels };
      levy_assessments:     { Row: LevyAssessment;     Insert: Partial<LevyAssessment>;     Update: Partial<LevyAssessment>;     Relationships: Rels };
      profiles:             { Row: Profile;             Insert: Partial<Profile>;             Update: Partial<Profile>;             Relationships: Rels };
      resident_invites:     { Row: ResidentInvite;     Insert: Partial<ResidentInvite>;     Update: Partial<ResidentInvite>;     Relationships: Rels };
      societies:            { Row: Society;            Insert: Partial<Society>;            Update: Partial<Society>;            Relationships: Rels };
      platform_owners:      { Row: PlatformOwner;      Insert: Partial<PlatformOwner>;      Update: Partial<PlatformOwner>;      Relationships: Rels };
      society_memberships:  { Row: SocietyMembership;  Insert: Partial<SocietyMembership>;  Update: Partial<SocietyMembership>;  Relationships: Rels };
      access_requests:      { Row: AccessRequest;      Insert: Partial<AccessRequest>;      Update: Partial<AccessRequest>;      Relationships: Rels };
      society_notices:      { Row: SocietyNotice;      Insert: Partial<SocietyNotice>;      Update: Partial<SocietyNotice>;      Relationships: Rels };
      society_documents:    { Row: SocietyDocument;    Insert: Partial<SocietyDocument>;    Update: Partial<SocietyDocument>;    Relationships: Rels };
      vendors:              { Row: Vendor;             Insert: Partial<Vendor>;             Update: Partial<Vendor>;             Relationships: Rels };
      vendor_contracts:     { Row: VendorContract;     Insert: Partial<VendorContract>;     Update: Partial<VendorContract>;     Relationships: Rels };
      assets:               { Row: Asset;              Insert: Partial<Asset>;              Update: Partial<Asset>;              Relationships: Rels };
      asset_service_records:{ Row: AssetServiceRecord; Insert: Partial<AssetServiceRecord>; Update: Partial<AssetServiceRecord>; Relationships: Rels };
      operational_expense_links: { Row: OperationalExpenseLink; Insert: Partial<OperationalExpenseLink>; Update: Partial<OperationalExpenseLink>; Relationships: Rels };
      society_attachments:  { Row: SocietyAttachment;  Insert: Partial<SocietyAttachment>;  Update: Partial<SocietyAttachment>;  Relationships: Rels };

      opening_balances:      { Row: OpeningBalance;      Insert: Partial<OpeningBalance>;      Update: Partial<OpeningBalance>;      Relationships: Rels };
      fund_ledger_entries:   { Row: FundLedgerEntry;      Insert: Partial<FundLedgerEntry>;     Update: Partial<FundLedgerEntry>;     Relationships: Rels };
      advance_settlements:   { Row: AdvanceSettlement;    Insert: Partial<AdvanceSettlement>;   Update: Partial<AdvanceSettlement>;   Relationships: Rels };
      bank_statement_batches: { Row: BankStatementBatch;  Insert: Partial<BankStatementBatch>;  Update: Partial<BankStatementBatch>;  Relationships: Rels };
      bank_statement_lines:   { Row: BankStatementLine;   Insert: Partial<BankStatementLine>;   Update: Partial<BankStatementLine>;   Relationships: Rels };
      resident_payment_links: { Row: ResidentPaymentLink; Insert: Partial<ResidentPaymentLink>; Update: Partial<ResidentPaymentLink>; Relationships: Rels };
      resident_payment_claims: { Row: ResidentPaymentClaim; Insert: Partial<ResidentPaymentClaim>; Update: Partial<ResidentPaymentClaim>; Relationships: Rels };
      push_subscriptions: { Row: PushSubscription; Insert: Partial<PushSubscription>; Update: Partial<PushSubscription>; Relationships: Rels };
      usage_counters:        { Row: UsageCounter;        Insert: Partial<UsageCounter>;        Update: Partial<UsageCounter>;        Relationships: Rels };
      society_usage_current: { Row: SocietyUsageCurrent; Insert: Partial<SocietyUsageCurrent>; Update: Partial<SocietyUsageCurrent>; Relationships: Rels };
      society_import_batches: { Row: SocietyImportBatch;  Insert: Partial<SocietyImportBatch>;  Update: Partial<SocietyImportBatch>;  Relationships: Rels };
      society_import_records: { Row: SocietyImportRecord; Insert: Partial<SocietyImportRecord>; Update: Partial<SocietyImportRecord>; Relationships: Rels };
    };
    Views: {
      v_dues_summary:         { Row: DuesSummary;             Relationships: Rels };
      v_monthly_collections:  { Row: Record<string, unknown>; Relationships: Rels };
      v_monthly_expenditures: { Row: Record<string, unknown>; Relationships: Rels };
    };
    Functions:      Record<string, { Args: Record<string, unknown>; Returns: unknown }>;
    Enums:          Record<string, string>;
    CompositeTypes: Record<string, Record<string, unknown>>;
  };
};
