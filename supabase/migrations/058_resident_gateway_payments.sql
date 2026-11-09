-- Resident gateway payments.
ALTER TABLE public.payments ADD COLUMN gateway_payment_id text;
CREATE UNIQUE INDEX payments_gateway_payment_id_key
  ON public.payments (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;

-- (b) One row per Razorpay Payment Link created for a resident.
CREATE TABLE public.resident_payment_links (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id          uuid NOT NULL REFERENCES public.societies(id),
  unit_id             uuid NOT NULL REFERENCES public.units(id),
  bill_ids            uuid[] NOT NULL,
  amount              numeric NOT NULL CHECK (amount > 0),
  razorpay_link_id    text NOT NULL UNIQUE,
  short_url           text NOT NULL,
  status              text NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created', 'paid', 'cancelled', 'expired')),
  razorpay_payment_id text,
  payment_id          uuid REFERENCES public.payments(id),
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz
);

-- Tenant integrity: a link's unit must belong to the same society as the link.
ALTER TABLE public.resident_payment_links ADD CONSTRAINT resident_payment_links_unit_same_society
  FOREIGN KEY (unit_id, society_id) REFERENCES public.units(id, society_id);

CREATE INDEX resident_payment_links_society_unit_status_idx
  ON public.resident_payment_links (society_id, unit_id, status);

ALTER TABLE public.resident_payment_links ENABLE ROW LEVEL SECURITY;

-- Residents see only their own flat's links.
CREATE POLICY resident_payment_links_resident_select ON public.resident_payment_links
  FOR SELECT TO authenticated
  USING (unit_id = private.auth_membership_unit(society_id));

-- Operators (admin/treasurer) see every link in their society; a Platform Owner
-- retains read access into a suspended society, matching the 055 operator pattern.
CREATE POLICY resident_payment_links_operator_select ON public.resident_payment_links
  FOR SELECT TO authenticated
  USING (private.auth_society_finance(society_id) OR private.auth_platform_suspended_read(society_id));

-- No INSERT/UPDATE/DELETE policy for any client role: all writes go through the
-- service role (which bypasses RLS entirely) and confirm_resident_payment() below.
-- This deliberately keeps residents from forging or mutating payment links.

-- Consistent with every other tenant-scoped table: append-only audit trail and no
-- hard delete, even though writes are already restricted to the service role.
CREATE TRIGGER trg_resident_payment_links_audit
  AFTER INSERT OR UPDATE ON public.resident_payment_links
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER trg_resident_payment_links_no_delete
  BEFORE DELETE ON public.resident_payment_links
  FOR EACH ROW EXECUTE FUNCTION public.prevent_operational_hard_delete();

-- (c) Transactional, idempotent webhook confirmation. Locks the link row first so
-- two concurrent deliveries of the same webhook cannot both record a payment; the
-- gateway_payment_id unique index is the second line of defence if the same
-- gateway payment id ever arrives against a different link row.
CREATE OR REPLACE FUNCTION public.confirm_resident_payment(
  p_link_id uuid,
  p_razorpay_payment_id text,
  p_method text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- Not the usual `search_path = ''`: inserting into payments fires five existing
-- triggers (receipt numbering, payment hashing via pgcrypto digest(), audit,
-- updated_at, hard-delete guard) that use unqualified names and the extensions
-- schema. A BEFORE/AFTER trigger inherits this function's search_path, so an empty
-- path makes them fail to resolve. An explicit, fixed `public, extensions` is
-- still injection-safe (it is not attacker-controllable) while letting those
-- triggers work. This function's own statements remain fully schema-qualified.
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_link public.resident_payment_links%ROWTYPE;
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_link
  FROM public.resident_payment_links l
  WHERE l.id = p_link_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_LINK_NOT_FOUND';
  END IF;

  -- Idempotent no-op: a duplicate webhook delivery for an already-confirmed link
  -- is expected (Razorpay retries), not an error.
  IF v_link.status = 'paid' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.payments (
    unit_id, society_id, bill_ids, amount_paid, payment_mode, payment_date,
    resident_id, recorded_by, months_covered, notes, gateway_payment_id
  ) VALUES (
    v_link.unit_id,
    v_link.society_id,
    v_link.bill_ids,
    v_link.amount,
    (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'OTHER' END)::public.payment_mode,
    current_date,
    NULL,
    NULL,
    0,
    'Online payment via Razorpay',
    p_razorpay_payment_id
  )
  ON CONFLICT (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_payment_id;

  IF v_payment_id IS NULL THEN
    SELECT p.id INTO v_payment_id
    FROM public.payments p
    WHERE p.gateway_payment_id = p_razorpay_payment_id;
  END IF;

  UPDATE public.bills b
    SET status = 'PAID'
    WHERE b.id = ANY(v_link.bill_ids)
      AND b.society_id = v_link.society_id
      AND b.status <> 'PAID';

  UPDATE public.resident_payment_links l
    SET status = 'paid',
        paid_at = now(),
        razorpay_payment_id = p_razorpay_payment_id,
        payment_id = v_payment_id
    WHERE l.id = v_link.id;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_resident_payment(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_resident_payment(uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
