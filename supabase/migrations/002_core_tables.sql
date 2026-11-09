-- Core tables.
CREATE TABLE society_config (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                        TEXT NOT NULL,
  registration_number         TEXT,
  address                     TEXT,
  mobile                      TEXT,
  pan_number                  TEXT,
  gstin                       TEXT,
  bank_name                   TEXT,
  bank_account_no             TEXT,
  bank_ifsc                   TEXT,
  upi_id                      TEXT,
  logo_url                    TEXT,
  receipt_prefix              TEXT NOT NULL DEFAULT 'REC',
  next_receipt_no             INTEGER NOT NULL DEFAULT 1,
  monthly_maintenance_amount  NUMERIC(10,2) NOT NULL DEFAULT 2000.00,
  penalty_rate_percent        NUMERIC(5,2) DEFAULT 0,
  financial_year_start_month  INTEGER DEFAULT 4,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- UNITS / FLATS
-- ─────────────────────────────────────────────
CREATE TABLE units (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flat_number      TEXT NOT NULL UNIQUE,
  flat_area_sqft   NUMERIC(8,2),
  monthly_amount   NUMERIC(10,2),
  notes            TEXT,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- RESIDENTS
-- ─────────────────────────────────────────────
CREATE TABLE residents (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id              uuid NOT NULL REFERENCES units(id),
  full_name            TEXT NOT NULL,
  occupancy_type       occupancy_type NOT NULL DEFAULT 'OWNER',
  phone                TEXT,
  email                TEXT,
  notification_channel notification_channel DEFAULT 'EMAIL',
  consent_given        BOOLEAN DEFAULT FALSE,
  consent_date         TIMESTAMPTZ,
  is_primary           BOOLEAN DEFAULT TRUE,
  move_in_date         DATE,
  move_out_date        DATE,
  is_active            BOOLEAN DEFAULT TRUE,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- BILLS (one per flat per month)
-- ─────────────────────────────────────────────
CREATE TABLE bills (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id            uuid NOT NULL REFERENCES units(id),
  bill_period_year   INTEGER NOT NULL,
  bill_period_month  INTEGER NOT NULL CHECK (bill_period_month BETWEEN 1 AND 12),
  invoice_number     TEXT NOT NULL UNIQUE,
  invoice_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date           DATE NOT NULL,
  base_amount        NUMERIC(10,2) NOT NULL,
  cgst_percent       NUMERIC(5,2) DEFAULT 0,
  sgst_percent       NUMERIC(5,2) DEFAULT 0,
  cgst_amount        NUMERIC(10,2) GENERATED ALWAYS AS (
                       ROUND(base_amount * cgst_percent / 100, 2)
                     ) STORED,
  sgst_amount        NUMERIC(10,2) GENERATED ALWAYS AS (
                       ROUND(base_amount * sgst_percent / 100, 2)
                     ) STORED,
  total_amount       NUMERIC(10,2) GENERATED ALWAYS AS (
                       base_amount
                       + ROUND(base_amount * cgst_percent / 100, 2)
                       + ROUND(base_amount * sgst_percent / 100, 2)
                     ) STORED,
  previous_due       NUMERIC(10,2) DEFAULT 0,
  penalty_amount     NUMERIC(10,2) DEFAULT 0,
  cheque_dishonour   NUMERIC(10,2) DEFAULT 0,
  payable_amount     NUMERIC(10,2) GENERATED ALWAYS AS (
                       base_amount
                       + ROUND(base_amount * cgst_percent / 100, 2)
                       + ROUND(base_amount * sgst_percent / 100, 2)
                       + previous_due + penalty_amount + cheque_dishonour
                     ) STORED,
  status             bill_status DEFAULT 'DRAFT',
  notes              TEXT,
  is_voided          BOOLEAN DEFAULT FALSE,
  void_reason        TEXT,
  voided_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (unit_id, bill_period_year, bill_period_month)
);

-- ─────────────────────────────────────────────────────────────────────────
-- PAYMENTS / TRANSACTIONS
-- IMMUTABLE RECORDS. No hard delete ever (enforced by trigger).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id             uuid NOT NULL REFERENCES units(id),
  resident_id         uuid REFERENCES residents(id),
  bill_ids            uuid[] DEFAULT '{}',
  amount_paid         NUMERIC(10,2) NOT NULL CHECK (amount_paid > 0),
  payment_mode        payment_mode NOT NULL,
  payment_date        DATE NOT NULL,
  payment_time        TIME,
  payment_timestamp   TIMESTAMPTZ,
  utr_reference       TEXT,
  collector_name      TEXT,
  months_covered      INTEGER DEFAULT 1,
  months_detail       TEXT,
  notes               TEXT,
  payment_status      payment_status DEFAULT 'PAID',
  is_voided           BOOLEAN DEFAULT FALSE,
  void_reason         TEXT,
  voided_by           TEXT,
  voided_at           TIMESTAMPTZ,
  receipt_number      TEXT UNIQUE,
  receipt_generated_at TIMESTAMPTZ,
  receipt_pdf_url     TEXT,
  row_hash            TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- EXPENDITURES
-- ─────────────────────────────────────────────
CREATE TABLE expenditures (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_date        DATE NOT NULL,
  category            expense_category NOT NULL,
  description         TEXT NOT NULL,
  amount              NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  paid_via            TEXT,
  payee_name          TEXT,
  reference_number    TEXT,
  bill_attachment_url TEXT,
  notes               TEXT,
  is_voided           BOOLEAN DEFAULT FALSE,
  void_reason         TEXT,
  voided_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- OTHER INCOME
-- ─────────────────────────────────────────────
CREATE TABLE other_income (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  income_date      DATE NOT NULL,
  category         income_category NOT NULL,
  description      TEXT NOT NULL,
  amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  received_via     TEXT,
  reference_number TEXT,
  notes            TEXT,
  is_voided        BOOLEAN DEFAULT FALSE,
  void_reason      TEXT,
  voided_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- AUDIT LOG (INSERT ONLY — enforced at DB level)
-- ─────────────────────────────────────────────
CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  action       audit_action NOT NULL,
  table_name   TEXT NOT NULL,
  record_id    TEXT,
  old_data     JSONB,
  new_data     JSONB,
  performed_by TEXT NOT NULL DEFAULT 'treasurer',
  ip_address   TEXT,
  user_agent   TEXT,
  session_id   TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM anon;

-- ─────────────────────────────────────────────
-- BALANCE SNAPSHOTS
-- ─────────────────────────────────────────────
CREATE TABLE balance_snapshots (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_date  DATE NOT NULL,
  bank_balance   NUMERIC(12,2),
  cash_in_hand   NUMERIC(12,2),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
