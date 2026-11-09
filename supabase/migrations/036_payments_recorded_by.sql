-- Payments recorded by.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS recorded_by TEXT;
