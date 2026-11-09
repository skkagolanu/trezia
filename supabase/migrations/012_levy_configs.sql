-- Levy configs.

CREATE TABLE IF NOT EXISTS levy_configs (
  id             uuid primary key default gen_random_uuid(),
  levy_label     text unique not null,
  default_amount numeric(10, 2) not null default 0,
  created_at     timestamptz default now()
);

ALTER TABLE levy_configs ENABLE ROW LEVEL SECURITY;

-- Authenticated users have full access (same pattern as society_config)
CREATE POLICY "levy_configs_authenticated_all" ON levy_configs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed the 5 known levies; ON CONFLICT is idempotent if this migration is re-run
INSERT INTO levy_configs (levy_label, default_amount) VALUES
  ('CMC-June-22', 1100),
  ('AMC-2023',    2000),
  ('CMC-2024',    1710),
  ('CMC-2025',    2300),
  ('AMC-2026',    2300)
ON CONFLICT (levy_label) DO NOTHING;
