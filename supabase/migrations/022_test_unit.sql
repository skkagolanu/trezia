-- Test unit.

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS is_test_unit boolean DEFAULT false NOT NULL;

INSERT INTO units (flat_number, is_active, is_test_unit, notes)
VALUES (
  'T00',
  true,
  true,
  'Test unit — always active but excluded from dues, collection totals, and reports. Use this flat to test all features safely.'
)
ON CONFLICT (flat_number) DO UPDATE
  SET is_active    = true,
      is_test_unit = true,
      notes        = EXCLUDED.notes;
