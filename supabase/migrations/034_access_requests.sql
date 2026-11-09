-- Access requests.

CREATE TABLE IF NOT EXISTS access_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  society_id      UUID NOT NULL REFERENCES societies(id),
  email           TEXT NOT NULL,
  unit_id         UUID NOT NULL REFERENCES units(id),
  submitted_name  TEXT,
  submitted_phone TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'APPROVED', 'DECLINED')),
  decline_reason  TEXT,
  decided_by      UUID REFERENCES auth.users(id),
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open request per email per society — a resubmission updates the row
-- rather than piling up duplicates the treasurer has to wade through.
CREATE UNIQUE INDEX IF NOT EXISTS uq_access_requests_open
  ON access_requests (society_id, lower(email))
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_access_requests_society_status
  ON access_requests (society_id, status);

-- never reads this table directly. The public submit path goes through the
-- API route (service client), which is where validation + rate-limiting live.
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;

-- Audit the decision trail (INSERT of a request, UPDATE on approve/decline).
DROP TRIGGER IF EXISTS audit_access_requests ON access_requests;
CREATE TRIGGER audit_access_requests
  AFTER INSERT OR UPDATE ON access_requests
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();
