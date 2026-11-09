-- Resident payment claims.

CREATE TABLE public.resident_payment_claims (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id             uuid NOT NULL REFERENCES public.societies(id),
  unit_id                uuid NOT NULL REFERENCES public.units(id),
  bill_ids               uuid[] NOT NULL,
  amount                 numeric NOT NULL CHECK (amount > 0),
  utr_reference          text,
  paid_on                date,
  screenshot_object_key  text NOT NULL,
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
  payment_id             uuid REFERENCES public.payments(id),
  review_note            text,
  submitted_by           uuid REFERENCES auth.users(id),
  submitted_at           timestamptz NOT NULL DEFAULT now(),
  reviewed_by            uuid REFERENCES auth.users(id),
  reviewed_at            timestamptz
);

-- Tenant integrity: a claim's unit must belong to the same society as the claim.
ALTER TABLE public.resident_payment_claims ADD CONSTRAINT resident_payment_claims_unit_same_society
  FOREIGN KEY (unit_id, society_id) REFERENCES public.units(id, society_id);

CREATE INDEX resident_payment_claims_society_status_submitted_idx
  ON public.resident_payment_claims (society_id, status, submitted_at DESC);
CREATE INDEX resident_payment_claims_unit_status_idx
  ON public.resident_payment_claims (unit_id, status);

ALTER TABLE public.resident_payment_claims ENABLE ROW LEVEL SECURITY;

-- Residents see only their own flat's claims.
CREATE POLICY resident_payment_claims_resident_select ON public.resident_payment_claims
  FOR SELECT TO authenticated
  USING (unit_id = private.auth_membership_unit(society_id));

-- Operators (admin/treasurer) see every claim in their society; a Platform Owner
-- retains read access into a suspended society, matching the 058 operator pattern.
CREATE POLICY resident_payment_claims_operator_select ON public.resident_payment_claims
  FOR SELECT TO authenticated
  USING (private.auth_society_finance(society_id) OR private.auth_platform_suspended_read(society_id));

-- No INSERT/UPDATE/DELETE policy for any client role: all writes go through the
-- service role (which bypasses RLS entirely) and the three RPCs below. This
-- deliberately keeps residents from forging or self-approving claims.

-- Consistent with every other tenant-scoped table: append-only audit trail and no
-- hard delete, even though writes are already restricted to the service role.
CREATE TRIGGER trg_resident_payment_claims_audit
  AFTER INSERT OR UPDATE ON public.resident_payment_claims
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER trg_resident_payment_claims_no_delete
  BEFORE DELETE ON public.resident_payment_claims
  FOR EACH ROW EXECUTE FUNCTION public.prevent_operational_hard_delete();

-- (a) Resident submits a claim. Serialized per unit so two concurrent submissions
-- against the same flat cannot both pass the dedup check.
CREATE OR REPLACE FUNCTION public.submit_resident_payment_claim(
  p_unit_id uuid,
  p_society_id uuid,
  p_bill_ids uuid[],
  p_amount numeric,
  p_utr text,
  p_paid_on date,
  p_screenshot_key text,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_claim_id uuid;
  v_claimable_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_unit_id::text, 0));

  SELECT count(*) INTO v_claimable_count
  FROM public.bills
  WHERE id = ANY(p_bill_ids)
    AND unit_id = p_unit_id
    AND society_id = p_society_id
    AND status <> 'PAID';

  IF v_claimable_count IS DISTINCT FROM array_length(p_bill_ids, 1) THEN
    RAISE EXCEPTION 'BILL_NOT_CLAIMABLE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.resident_payment_claims
    WHERE unit_id = p_unit_id AND status = 'pending' AND bill_ids && p_bill_ids
  ) THEN
    RAISE EXCEPTION 'PENDING_CLAIM_EXISTS';
  END IF;

  INSERT INTO public.resident_payment_claims (
    society_id, unit_id, bill_ids, amount, utr_reference, paid_on,
    screenshot_object_key, status, submitted_by
  ) VALUES (
    p_society_id, p_unit_id, p_bill_ids, p_amount, p_utr, p_paid_on,
    p_screenshot_key, 'pending', p_user_id
  )
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$;

-- (b) Treasurer approves a claim: creates the real payment and marks the target
-- bills PAID. Idempotent — a duplicate approval call for an already-approved
-- claim returns the existing payment id rather than erroring or double-recording.
CREATE OR REPLACE FUNCTION public.approve_resident_payment_claim(
  p_claim_id uuid,
  p_reviewer_id uuid,
  p_method text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- Not the usual `search_path = ''`: inserting into payments fires existing
-- triggers (receipt numbering, payment hashing via pgcrypto digest(), audit,
-- updated_at, hard-delete guard) that use unqualified names and the extensions
-- schema. A BEFORE/AFTER trigger inherits this function's search_path, so an
-- empty path makes them fail to resolve. An explicit, fixed `public, extensions`
-- is still injection-safe (not attacker-controllable) while letting those
-- triggers work. This function's own statements remain fully schema-qualified.
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_claim public.resident_payment_claims%ROWTYPE;
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_claim
  FROM public.resident_payment_claims c
  WHERE c.id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND';
  END IF;

  -- Idempotent no-op: a duplicate approval call for an already-approved claim
  -- is expected (retry after a transient failure), not an error.
  IF v_claim.status = 'approved' THEN
    RETURN v_claim.payment_id;
  END IF;

  IF v_claim.status = 'rejected' THEN
    RAISE EXCEPTION 'CLAIM_NOT_PENDING';
  END IF;

  INSERT INTO public.payments (
    unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
    utr_reference, resident_id, recorded_by, months_covered, notes
  ) VALUES (
    v_claim.unit_id,
    v_claim.society_id,
    v_claim.bill_ids,
    v_claim.amount,
    (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'MANUAL_COLLECTION' END)::public.payment_mode,
    COALESCE(v_claim.paid_on, current_date),
    v_claim.utr_reference,
    NULL,
    NULL,
    0,
    'Approved from uploaded payment proof'
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.bills b
    SET status = 'PAID'
    WHERE b.id = ANY(v_claim.bill_ids)
      AND b.society_id = v_claim.society_id
      AND b.status <> 'PAID';

  UPDATE public.resident_payment_claims c
    SET status = 'approved',
        payment_id = v_payment_id,
        reviewed_by = p_reviewer_id,
        reviewed_at = now()
    WHERE c.id = v_claim.id;

  RETURN v_payment_id;
END;
$$;

-- (c) Treasurer rejects a claim.
CREATE OR REPLACE FUNCTION public.reject_resident_payment_claim(
  p_claim_id uuid,
  p_reviewer_id uuid,
  p_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_claim public.resident_payment_claims%ROWTYPE;
BEGIN
  SELECT * INTO v_claim
  FROM public.resident_payment_claims c
  WHERE c.id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND OR v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'CLAIM_NOT_PENDING';
  END IF;

  UPDATE public.resident_payment_claims c
    SET status = 'rejected',
        review_note = p_note,
        reviewed_by = p_reviewer_id,
        reviewed_at = now()
    WHERE c.id = v_claim.id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_resident_payment_claim(uuid, uuid, uuid[], numeric, text, date, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_resident_payment_claim(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_resident_payment_claim(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_resident_payment_claim(uuid, uuid, uuid[], numeric, text, date, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_resident_payment_claim(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_resident_payment_claim(uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
