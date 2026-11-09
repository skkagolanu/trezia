-- Societies multi tenant.
CREATE TABLE societies (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,   -- URL-safe identifier, e.g. for a future /s/[slug] path
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_societies_ts BEFORE UPDATE ON societies FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE societies ENABLE ROW LEVEL SECURITY;


INSERT INTO societies (name, slug) VALUES ('OAK', 'oak');

-- ── Add society_id to every tenant-scoped table (nullable first) ──────────────
ALTER TABLE society_config      ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE units                ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE residents             ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE payments              ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE bills                 ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE expenditures          ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE other_income          ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE audit_log             ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE balance_snapshots     ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE amc_collections       ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE treasurer_handovers   ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE levy_configs          ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE profiles              ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE resident_invites      ADD COLUMN society_id uuid REFERENCES societies(id);

ALTER TABLE opening_balances        ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE fund_ledger_entries      ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE advance_settlements      ADD COLUMN society_id uuid REFERENCES societies(id);
ALTER TABLE bank_statement_batches   ADD COLUMN society_id uuid REFERENCES societies(id);
-- bank_statement_lines is intentionally NOT given its own society_id: it's
-- always accessed through its parent batch_id (ON DELETE CASCADE already
-- ties its lifecycle to bank_statement_batches), so scoping the batch is
-- sufficient — a second society_id column here would just be a second
-- source of truth that could drift from the parent's.

-- ── Backfill: every existing row belongs to OAK ────────────────────────────────
DO $$
DECLARE v_oak uuid;
BEGIN
  SELECT id INTO v_oak FROM societies WHERE slug = 'oak';

  UPDATE society_config    SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE units              SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE residents           SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE payments            SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE bills               SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE expenditures        SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE other_income        SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE audit_log           SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE balance_snapshots   SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE amc_collections     SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE treasurer_handovers SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE levy_configs        SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE profiles            SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE resident_invites    SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE opening_balances       SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE fund_ledger_entries    SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE advance_settlements    SET society_id = v_oak WHERE society_id IS NULL;
  UPDATE bank_statement_batches SET society_id = v_oak WHERE society_id IS NULL;
END $$;

-- ── Enforce NOT NULL now that every row is backfilled ──────────────────────────
ALTER TABLE society_config      ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE units                ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE residents             ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE payments              ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE bills                 ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE expenditures          ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE other_income          ALTER COLUMN society_id SET NOT NULL;
-- audit_log.society_id stays NULLABLE: pre-multi-tenant rows and any future
-- still be insertable. New rows get it populated by log_audit_event() (032).
ALTER TABLE balance_snapshots     ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE amc_collections       ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE treasurer_handovers   ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE levy_configs          ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE profiles              ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE resident_invites       ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE opening_balances        ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE fund_ledger_entries      ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE advance_settlements      ALTER COLUMN society_id SET NOT NULL;
ALTER TABLE bank_statement_batches   ALTER COLUMN society_id SET NOT NULL;

-- ── Composite unique constraints replace global-uniqueness assumptions ─────────
ALTER TABLE units   DROP CONSTRAINT units_flat_number_key;
ALTER TABLE units   ADD  CONSTRAINT units_society_flat_number_key UNIQUE (society_id, flat_number);

ALTER TABLE payments DROP CONSTRAINT payments_receipt_number_key;
ALTER TABLE payments ADD  CONSTRAINT payments_society_receipt_number_key UNIQUE (society_id, receipt_number);

ALTER TABLE bills   DROP CONSTRAINT bills_invoice_number_key;
ALTER TABLE bills   ADD  CONSTRAINT bills_society_invoice_number_key UNIQUE (society_id, invoice_number);

ALTER TABLE levy_configs DROP CONSTRAINT levy_configs_levy_label_key;
ALTER TABLE levy_configs ADD  CONSTRAINT levy_configs_society_levy_label_key UNIQUE (society_id, levy_label);

ALTER TABLE resident_invites DROP CONSTRAINT resident_invites_email_key;
ALTER TABLE resident_invites ADD  CONSTRAINT resident_invites_society_email_key UNIQUE (society_id, email);

ALTER TABLE opening_balances DROP CONSTRAINT opening_balances_fy_start_year_key;
ALTER TABLE opening_balances ADD  CONSTRAINT opening_balances_society_fy_key UNIQUE (society_id, fy_start_year);

-- society_config: exactly one config row per society (today's ".single()" reads
-- throughout the app become ".eq('society_id', societyId).single()" — see the
ALTER TABLE society_config ADD CONSTRAINT society_config_one_per_society UNIQUE (society_id);

-- bills' existing UNIQUE(unit_id, bill_period_year, bill_period_month) needs no
-- change — unit_id is already tenant-specific (units are never shared across
-- societies), so it's already collision-safe.

-- ── Indexes: every RLS policy in 032 filters on society_id — index it everywhere ──
CREATE INDEX idx_units_society              ON units(society_id);
CREATE INDEX idx_residents_society           ON residents(society_id);
CREATE INDEX idx_payments_society            ON payments(society_id);
CREATE INDEX idx_bills_society               ON bills(society_id);
CREATE INDEX idx_expenditures_society        ON expenditures(society_id);
CREATE INDEX idx_other_income_society        ON other_income(society_id);
CREATE INDEX idx_audit_log_society           ON audit_log(society_id);
CREATE INDEX idx_balance_snapshots_society   ON balance_snapshots(society_id);
CREATE INDEX idx_amc_collections_society     ON amc_collections(society_id);
CREATE INDEX idx_treasurer_handovers_society ON treasurer_handovers(society_id);
CREATE INDEX idx_levy_configs_society        ON levy_configs(society_id);
CREATE INDEX idx_profiles_society            ON profiles(society_id);
CREATE INDEX idx_resident_invites_society    ON resident_invites(society_id);
CREATE INDEX idx_opening_balances_society    ON opening_balances(society_id);
CREATE INDEX idx_fund_ledger_society         ON fund_ledger_entries(society_id);
CREATE INDEX idx_advance_settlements_society ON advance_settlements(society_id);
CREATE INDEX idx_bank_statement_batches_society ON bank_statement_batches(society_id);


CREATE OR REPLACE FUNCTION assign_receipt_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_society uuid;
  v_prefix  TEXT;
  v_next    INTEGER;
BEGIN
  IF NEW.receipt_number IS NULL THEN
    SELECT society_id INTO v_society FROM units WHERE id = NEW.unit_id;

    SELECT receipt_prefix, next_receipt_no
    INTO   v_prefix, v_next
    FROM   society_config
    WHERE  society_id = v_society
    FOR UPDATE;

    NEW.receipt_number       = v_prefix || '-' || LPAD(v_next::TEXT, 4, '0');
    NEW.receipt_generated_at = NOW();

    UPDATE society_config SET next_receipt_no = next_receipt_no + 1 WHERE society_id = v_society;
  END IF;
  RETURN NEW;
END;
$$;
