-- Triggers.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_units_ts       BEFORE UPDATE ON units       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_residents_ts   BEFORE UPDATE ON residents   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_payments_ts    BEFORE UPDATE ON payments    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bills_ts       BEFORE UPDATE ON bills       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_expenses_ts    BEFORE UPDATE ON expenditures FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_income_ts      BEFORE UPDATE ON other_income FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_snapshots_ts   BEFORE UPDATE ON balance_snapshots FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_config_ts      BEFORE UPDATE ON society_config FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Prevent hard DELETE on all financial tables ───────────
CREATE OR REPLACE FUNCTION prevent_hard_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Hard delete is permanently disabled on table %. '
    'Set is_voided = TRUE with a mandatory void_reason instead.',
    TG_TABLE_NAME;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_no_delete_payments     BEFORE DELETE ON payments     FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
CREATE TRIGGER trg_no_delete_bills        BEFORE DELETE ON bills        FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
CREATE TRIGGER trg_no_delete_expenditures BEFORE DELETE ON expenditures FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
CREATE TRIGGER trg_no_delete_income       BEFORE DELETE ON other_income FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ── Row hash (tamper evidence) on payment INSERT ──────────
CREATE OR REPLACE FUNCTION set_payment_hash()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.row_hash = encode(
    digest(
      NEW.unit_id::TEXT        || '|' ||
      NEW.amount_paid::TEXT    || '|' ||
      NEW.payment_date::TEXT   || '|' ||
      COALESCE(NEW.utr_reference, '') || '|' ||
      NEW.payment_mode::TEXT,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_hash
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION set_payment_hash();

-- ── Atomic sequential receipt number assignment ───────────
CREATE OR REPLACE FUNCTION assign_receipt_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_prefix TEXT;
  v_next   INTEGER;
BEGIN
  IF NEW.receipt_number IS NULL THEN
    SELECT receipt_prefix, next_receipt_no
    INTO   v_prefix, v_next
    FROM   society_config
    LIMIT  1
    FOR UPDATE;

    NEW.receipt_number       = v_prefix || '-' || LPAD(v_next::TEXT, 4, '0');
    NEW.receipt_generated_at = NOW();

    UPDATE society_config SET next_receipt_no = next_receipt_no + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_receipt
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION assign_receipt_number();

-- ── Generic audit log trigger ─────────────────────────────
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (action, table_name, record_id, new_data, performed_by)
    VALUES (
      'INSERT', TG_TABLE_NAME, NEW.id::TEXT,
      row_to_json(NEW)::JSONB,
      COALESCE(current_setting('app.current_user', TRUE), 'system')
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (action, table_name, record_id, old_data, new_data, performed_by)
    VALUES (
      'UPDATE', TG_TABLE_NAME, NEW.id::TEXT,
      row_to_json(OLD)::JSONB,
      row_to_json(NEW)::JSONB,
      COALESCE(current_setting('app.current_user', TRUE), 'system')
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_payments     AFTER INSERT OR UPDATE ON payments     FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER trg_audit_bills        AFTER INSERT OR UPDATE ON bills        FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER trg_audit_expenditures AFTER INSERT OR UPDATE ON expenditures FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER trg_audit_income       AFTER INSERT OR UPDATE ON other_income FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER trg_audit_residents    AFTER INSERT OR UPDATE ON residents    FOR EACH ROW EXECUTE FUNCTION log_audit_event();
