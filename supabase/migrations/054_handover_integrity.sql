-- Handover integrity.

ALTER TABLE public.treasurer_handovers
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_treasurer_handovers_updated_at ON public.treasurer_handovers;
CREATE TRIGGER trg_treasurer_handovers_updated_at
  BEFORE UPDATE ON public.treasurer_handovers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_audit_treasurer_handovers ON public.treasurer_handovers;
CREATE TRIGGER trg_audit_treasurer_handovers
  AFTER INSERT OR UPDATE ON public.treasurer_handovers
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS trg_no_delete_treasurer_handovers ON public.treasurer_handovers;
CREATE TRIGGER trg_no_delete_treasurer_handovers
  BEFORE DELETE ON public.treasurer_handovers
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

-- Migration 046 used a combined ALL-command policy for finance writes. Split that policy so INSERT
-- and UPDATE keep identical tenant checks while DELETE has no policy at all.
DROP POLICY IF EXISTS treasurer_handovers_membership_write ON public.treasurer_handovers;

CREATE POLICY treasurer_handovers_membership_insert
  ON public.treasurer_handovers FOR INSERT TO authenticated
  WITH CHECK (private.auth_society_finance(society_id));

CREATE POLICY treasurer_handovers_membership_update
  ON public.treasurer_handovers FOR UPDATE TO authenticated
  USING (private.auth_society_finance(society_id))
  WITH CHECK (private.auth_society_finance(society_id));

NOTIFY pgrst, 'reload schema';
