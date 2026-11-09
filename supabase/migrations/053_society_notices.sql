-- Society notices.
CREATE TABLE public.society_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  title text NOT NULL,
  body text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  archived_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT society_notices_title_not_blank CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT society_notices_body_not_blank CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  CONSTRAINT society_notices_expiry_after_publication CHECK (
    expires_at IS NULL OR expires_at > published_at
  )
);

CREATE INDEX society_notices_society_published_idx
  ON public.society_notices (society_id, published_at DESC, id DESC);
CREATE INDEX society_notices_resident_feed_idx
  ON public.society_notices (society_id, published_at DESC, id DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER trg_society_notices_ts
  BEFORE UPDATE ON public.society_notices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.society_notices ENABLE ROW LEVEL SECURITY;

-- Admins and Treasurers operate only inside their active, request-scoped
-- society. Platform owners retain their existing suspended-society read path.
CREATE POLICY society_notices_operator_select ON public.society_notices
  FOR SELECT TO authenticated
  USING (
    private.auth_society_finance(society_id)
    OR private.auth_platform_suspended_read(society_id)
  );

CREATE POLICY society_notices_resident_select ON public.society_notices
  FOR SELECT TO authenticated
  USING (
    private.auth_membership_role(society_id) = 'resident'
    AND published_at <= now()
    AND archived_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  );

CREATE POLICY society_notices_operator_insert ON public.society_notices
  FOR INSERT TO authenticated
  WITH CHECK (
    private.auth_society_finance(society_id)
    AND created_by = (SELECT auth.uid())
  );

CREATE POLICY society_notices_operator_update ON public.society_notices
  FOR UPDATE TO authenticated
  USING (private.auth_society_finance(society_id))
  WITH CHECK (private.auth_society_finance(society_id));

NOTIFY pgrst, 'reload schema';
