-- Fy treasurers.

CREATE TABLE IF NOT EXISTS fy_treasurers (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  society_id    uuid NOT NULL DEFAULT default_society_id() REFERENCES societies(id),
  fy_start_year INTEGER NOT NULL,          -- e.g. 2026 = FY 2026–27
  resident_id   uuid NOT NULL REFERENCES residents(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (society_id, fy_start_year)
);

CREATE TRIGGER trg_fy_treasurers_ts BEFORE UPDATE ON fy_treasurers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_fy_treasurers_society ON fy_treasurers(society_id);

ALTER TABLE fy_treasurers ENABLE ROW LEVEL SECURITY;

-- Same tenant-scoped pattern as levy_configs (migration 032). Writes go through
CREATE POLICY "fy_treasurers_write_all" ON fy_treasurers
  FOR ALL TO authenticated
  USING ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()))
  WITH CHECK ((select auth_write_tier()) AND society_id = (select auth_profile_society_id()));
CREATE POLICY "fy_treasurers_read_only" ON fy_treasurers
  FOR SELECT TO authenticated
  USING ((select auth_read_tier()) AND society_id = (select auth_profile_society_id()));

-- AMC/CMC levy payments carry "recorded by" too.
ALTER TABLE amc_collections ADD COLUMN IF NOT EXISTS recorded_by TEXT;
