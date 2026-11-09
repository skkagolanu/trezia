-- Amc collections soft delete.

ALTER TABLE amc_collections
  ADD COLUMN IF NOT EXISTS is_voided   BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;

-- Fast filter for active records
CREATE INDEX IF NOT EXISTS idx_amc_is_voided ON amc_collections(is_voided)
  WHERE NOT is_voided;

-- Block hard DELETEs — same guarantee as payments/bills/expenditures
CREATE OR REPLACE FUNCTION prevent_hard_delete_amc()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Hard delete on amc_collections is not permitted. Void the record instead (is_voided = true).';
END;
$$;

CREATE TRIGGER tg_prevent_amc_delete
  BEFORE DELETE ON amc_collections
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete_amc();
