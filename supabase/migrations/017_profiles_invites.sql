-- Profiles invites.
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'resident')),
  unit_id    UUID REFERENCES units(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: each user can only see their own row; service role has full access
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (id = auth.uid());

-- ── resident_invites ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resident_invites (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT UNIQUE NOT NULL,
  role        TEXT NOT NULL DEFAULT 'resident' CHECK (role IN ('admin', 'resident')),
  unit_id     UUID REFERENCES units(id),
  invited_by  UUID NOT NULL REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  claimed_at  TIMESTAMPTZ,
  claimed_by  UUID REFERENCES auth.users(id)
);

-- Service-role only — no client access at all
ALTER TABLE resident_invites ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policies: only service role (which bypasses RLS) can touch this table
