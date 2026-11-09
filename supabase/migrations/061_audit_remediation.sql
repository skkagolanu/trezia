-- Audit remediation.

ALTER TABLE public.resident_payment_links
  ADD COLUMN IF NOT EXISTS reconciliation_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconciliation_note text;

CREATE OR REPLACE FUNCTION public.assert_payable_bills(
  p_society_id uuid, p_unit_id uuid, p_bill_ids uuid[], p_amount numeric
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_count integer; v_total numeric;
BEGIN
  IF p_bill_ids IS NULL OR cardinality(p_bill_ids) = 0
     OR cardinality(p_bill_ids) <> cardinality(ARRAY(SELECT DISTINCT x FROM unnest(p_bill_ids) AS x)) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_BILL_IDS';
  END IF;
  PERFORM 1 FROM public.bills b
    WHERE b.id = ANY(p_bill_ids) AND b.society_id = p_society_id AND b.unit_id = p_unit_id
    ORDER BY b.id FOR UPDATE;
  SELECT count(*), coalesce(sum(b.payable_amount), 0) INTO v_count, v_total
  FROM public.bills b
  WHERE b.id = ANY(p_bill_ids) AND b.society_id = p_society_id AND b.unit_id = p_unit_id
    AND b.is_voided = false AND b.status IN ('ISSUED', 'OVERDUE');
  IF v_count <> cardinality(p_bill_ids) THEN RAISE EXCEPTION 'BILL_NOT_PAYABLE'; END IF;
  IF p_amount IS DISTINCT FROM v_total THEN RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_resident_payment_claim(p_claim_id uuid, p_reviewer_id uuid, p_method text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_claim public.resident_payment_claims%ROWTYPE; v_payment_id uuid;
BEGIN
  SELECT * INTO v_claim FROM public.resident_payment_claims c WHERE c.id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF v_claim.status = 'approved' THEN RETURN v_claim.payment_id; END IF;
  IF v_claim.status <> 'pending' THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;
  PERFORM public.assert_payable_bills(v_claim.society_id, v_claim.unit_id, v_claim.bill_ids, v_claim.amount);
  INSERT INTO public.payments (unit_id,society_id,bill_ids,amount_paid,payment_mode,payment_date,utr_reference,months_covered,notes)
  VALUES (v_claim.unit_id,v_claim.society_id,v_claim.bill_ids,v_claim.amount,
    (CASE WHEN lower(p_method) = 'upi' THEN 'UPI' ELSE 'MANUAL_COLLECTION' END)::public.payment_mode,
    coalesce(v_claim.paid_on,current_date),v_claim.utr_reference,0,'Approved from uploaded payment proof') RETURNING id INTO v_payment_id;
  UPDATE public.bills SET status = 'PAID'
  WHERE id = ANY(v_claim.bill_ids) AND society_id = v_claim.society_id AND unit_id = v_claim.unit_id;
  UPDATE public.resident_payment_claims SET status='approved', payment_id=v_payment_id, reviewed_by=p_reviewer_id, reviewed_at=now() WHERE id=v_claim.id;
  RETURN v_payment_id;
END;
$$;

-- The old three-argument RPC is deliberately removed: the webhook handler must
-- pass the signed facts it extracted from Razorpay, rather than a caller-chosen id.
DROP FUNCTION IF EXISTS public.confirm_resident_payment(uuid, text, text);
CREATE OR REPLACE FUNCTION public.confirm_resident_payment(
  p_link_id uuid, p_razorpay_link_id text, p_razorpay_payment_id text,
  p_amount_subunits bigint, p_currency text, p_status text, p_method text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_link public.resident_payment_links%ROWTYPE; v_payment_id uuid;
BEGIN
  SELECT * INTO v_link FROM public.resident_payment_links l WHERE l.id=p_link_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_LINK_NOT_FOUND'; END IF;
  IF v_link.status = 'paid' THEN RETURN v_link.payment_id; END IF;
  IF p_razorpay_link_id IS DISTINCT FROM v_link.razorpay_link_id
     OR p_currency IS DISTINCT FROM 'INR' OR p_status IS DISTINCT FROM 'captured'
     OR p_amount_subunits IS DISTINCT FROM (v_link.amount * 100)::bigint THEN
    UPDATE public.resident_payment_links SET reconciliation_required=true,
      reconciliation_note='Webhook facts conflict with payment link' WHERE id=v_link.id;
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public.assert_payable_bills(v_link.society_id,v_link.unit_id,v_link.bill_ids,v_link.amount);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%BILL_NOT_PAYABLE%' OR SQLERRM LIKE '%PAYMENT_AMOUNT_MISMATCH%' THEN
      INSERT INTO public.payments (unit_id,society_id,bill_ids,amount_paid,payment_mode,payment_date,months_covered,notes,gateway_payment_id)
      VALUES (v_link.unit_id,v_link.society_id,'{}'::uuid[],v_link.amount,
        (CASE WHEN lower(p_method)='upi' THEN 'UPI' ELSE 'OTHER' END)::public.payment_mode,current_date,0,
        'Online payment via Razorpay — reconciliation required',p_razorpay_payment_id)
      ON CONFLICT (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL DO NOTHING RETURNING id INTO v_payment_id;
      IF v_payment_id IS NULL THEN
        SELECT id INTO v_payment_id FROM public.payments
        WHERE gateway_payment_id=p_razorpay_payment_id AND society_id=v_link.society_id AND unit_id=v_link.unit_id;
      END IF;
      IF v_payment_id IS NULL THEN RAISE EXCEPTION 'GATEWAY_PAYMENT_CONFLICT'; END IF;
      UPDATE public.resident_payment_links SET reconciliation_required=true,
        reconciliation_note='Paid gateway link references bills no longer payable',razorpay_payment_id=p_razorpay_payment_id,
        payment_id=v_payment_id,paid_at=now(),status='paid' WHERE id=v_link.id;
      RETURN v_payment_id;
    END IF;
    RAISE;
  END;
  INSERT INTO public.payments (unit_id,society_id,bill_ids,amount_paid,payment_mode,payment_date,months_covered,notes,gateway_payment_id)
  VALUES (v_link.unit_id,v_link.society_id,v_link.bill_ids,v_link.amount,
    (CASE WHEN lower(p_method)='upi' THEN 'UPI' ELSE 'OTHER' END)::public.payment_mode,current_date,0,'Online payment via Razorpay',p_razorpay_payment_id)
  ON CONFLICT (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL DO NOTHING RETURNING id INTO v_payment_id;
  IF v_payment_id IS NULL THEN
    SELECT id INTO v_payment_id FROM public.payments
    WHERE gateway_payment_id=p_razorpay_payment_id AND society_id=v_link.society_id AND unit_id=v_link.unit_id;
  END IF;
  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'GATEWAY_PAYMENT_CONFLICT'; END IF;
  UPDATE public.bills SET status='PAID'
  WHERE id=ANY(v_link.bill_ids) AND society_id=v_link.society_id AND unit_id=v_link.unit_id;
  UPDATE public.resident_payment_links SET status='paid',paid_at=now(),razorpay_payment_id=p_razorpay_payment_id,payment_id=v_payment_id WHERE id=v_link.id;
  RETURN v_payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_payment_transactional(p_payment_id uuid, p_society_id uuid, p_actor_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_payment public.payments%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM public.payments p WHERE p.id=p_payment_id AND p.society_id=p_society_id FOR UPDATE;
  IF NOT FOUND OR v_payment.is_voided THEN RAISE EXCEPTION 'PAYMENT_NOT_ACTIVE'; END IF;
  UPDATE public.payments SET is_voided=true,void_reason=p_reason,voided_by=p_actor_id::text,voided_at=now() WHERE id=v_payment.id;
  IF cardinality(v_payment.bill_ids) > 0 THEN
    PERFORM 1 FROM public.bills b
    WHERE b.id=ANY(v_payment.bill_ids) AND b.society_id=v_payment.society_id AND b.unit_id=v_payment.unit_id FOR UPDATE;
    UPDATE public.bills b SET status=CASE WHEN b.due_date < current_date THEN 'OVERDUE'::public.bill_status ELSE 'ISSUED'::public.bill_status END
    WHERE b.id=ANY(v_payment.bill_ids) AND b.society_id=v_payment.society_id AND b.unit_id=v_payment.unit_id AND b.is_voided=false AND NOT EXISTS (
      SELECT 1 FROM public.payments p WHERE p.id<>v_payment.id AND p.is_voided=false AND b.id=ANY(p.bill_ids));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_manual_payment(
  p_society_id uuid,p_actor_id uuid,p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_payment_id uuid; v_unit_id uuid; v_resident_id uuid; v_bill_ids uuid[]; v_amount numeric; v_mode text; v_date date; v_time time; v_utr text; v_collector text; v_recorded_by text; v_months integer; v_detail text; v_notes text;
BEGIN
  SELECT (p_payload->>'unit_id')::uuid, nullif(p_payload->>'resident_id','')::uuid,
    CASE WHEN jsonb_typeof(p_payload->'bill_ids') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'bill_ids')::uuid) ELSE '{}'::uuid[] END,
    coalesce((p_payload->>'amount_paid')::numeric,(p_payload->>'amount')::numeric), p_payload->>'payment_mode', (p_payload->>'payment_date')::date,
    nullif(p_payload->>'payment_time','')::time, nullif(p_payload->>'utr_reference',''), nullif(p_payload->>'collector_name',''), nullif(p_payload->>'recorded_by',''),
    coalesce((p_payload->>'months_covered')::integer,1), nullif(p_payload->>'months_detail',''), nullif(p_payload->>'notes','')
    INTO v_unit_id,v_resident_id,v_bill_ids,v_amount,v_mode,v_date,v_time,v_utr,v_collector,v_recorded_by,v_months,v_detail,v_notes;
  IF NOT EXISTS (SELECT 1 FROM public.units u WHERE u.id=v_unit_id AND u.society_id=p_society_id)
     OR (v_resident_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.residents r WHERE r.id=v_resident_id AND r.unit_id=v_unit_id)) THEN
    RAISE EXCEPTION 'PAYMENT_TENANT_MISMATCH';
  END IF;
  IF cardinality(v_bill_ids) > 0 THEN PERFORM public.assert_payable_bills(p_society_id,v_unit_id,v_bill_ids,v_amount); END IF;
  INSERT INTO public.payments(unit_id,society_id,resident_id,bill_ids,amount_paid,payment_mode,payment_date,payment_time,utr_reference,collector_name,recorded_by,months_covered,months_detail,notes)
  VALUES(v_unit_id,p_society_id,v_resident_id,v_bill_ids,v_amount,v_mode::public.payment_mode,v_date,v_time,v_utr,v_collector,v_recorded_by,v_months,v_detail,v_notes) RETURNING id INTO v_payment_id;
  IF cardinality(v_bill_ids) > 0 THEN
    UPDATE public.bills SET status='PAID' WHERE id=ANY(v_bill_ids) AND society_id=p_society_id AND unit_id=v_unit_id;
  END IF;
  RETURN v_payment_id;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_lines_active_target_key
  ON public.bank_statement_lines (matched_table, matched_id) WHERE matched_id IS NOT NULL AND is_ignored=false;

CREATE OR REPLACE FUNCTION public.reconcile_bank_statement_line(p_society_id uuid,p_batch_id uuid,p_line_id uuid,p_actor_id uuid,p_action text,p_matched_table text,p_matched_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_line public.bank_statement_lines%ROWTYPE; v_society_id uuid; v_exists boolean;
BEGIN
  SELECT l.* INTO v_line FROM public.bank_statement_lines l WHERE l.id=p_line_id AND l.batch_id=p_batch_id FOR UPDATE;
  SELECT b.society_id INTO v_society_id FROM public.bank_statement_batches b WHERE b.id=p_batch_id;
  IF v_line.id IS NULL OR v_society_id IS DISTINCT FROM p_society_id THEN RAISE EXCEPTION 'BANK_LINE_NOT_FOUND'; END IF;
  IF p_action = 'unmatch' THEN
    UPDATE public.bank_statement_lines SET matched_table=NULL,matched_id=NULL,matched_at=NULL,matched_by=p_actor_id WHERE id=v_line.id;
    RETURN;
  END IF;
  IF p_action = 'ignore' THEN
    IF v_line.matched_id IS NOT NULL OR v_line.is_ignored THEN RAISE EXCEPTION 'BANK_LINE_NOT_IGNORABLE'; END IF;
    UPDATE public.bank_statement_lines SET is_ignored=true,matched_at=NULL,matched_by=p_actor_id WHERE id=v_line.id;
    RETURN;
  END IF;
  IF p_action <> 'match' OR v_line.matched_id IS NOT NULL OR v_line.is_ignored THEN RAISE EXCEPTION 'BANK_LINE_NOT_MATCHABLE'; END IF;
  SELECT CASE p_matched_table WHEN 'payments' THEN EXISTS(SELECT 1 FROM public.payments x WHERE x.id=p_matched_id AND x.society_id=v_society_id AND x.is_voided=false)
    WHEN 'amc_collections' THEN EXISTS(SELECT 1 FROM public.amc_collections x WHERE x.id=p_matched_id AND x.society_id=v_society_id AND x.is_voided=false)
    WHEN 'other_income' THEN EXISTS(SELECT 1 FROM public.other_income x WHERE x.id=p_matched_id AND x.society_id=v_society_id AND x.is_voided=false)
    WHEN 'expenditures' THEN EXISTS(SELECT 1 FROM public.expenditures x WHERE x.id=p_matched_id AND x.society_id=v_society_id AND x.is_voided=false) ELSE false END INTO v_exists;
  IF NOT v_exists THEN RAISE EXCEPTION 'BANK_MATCH_TARGET_INVALID'; END IF;
  UPDATE public.bank_statement_lines SET matched_table=p_matched_table,matched_id=p_matched_id,matched_at=now(),matched_by=p_actor_id WHERE id=v_line.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_push_subscription(p_user_id uuid,p_society_id uuid,p_endpoint text,p_p256dh text,p_auth text,p_user_agent text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.push_subscriptions WHERE endpoint=p_endpoint FOR UPDATE;
  IF v_owner IS NOT NULL AND v_owner IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'PUSH_ENDPOINT_OWNED_BY_ANOTHER_USER';
  END IF;
  INSERT INTO public.push_subscriptions(user_id,society_id,endpoint,p256dh,auth,user_agent)
  VALUES(p_user_id,p_society_id,p_endpoint,p_p256dh,p_auth,p_user_agent)
  ON CONFLICT(endpoint) DO UPDATE SET society_id=EXCLUDED.society_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,user_agent=EXCLUDED.user_agent
  WHERE public.push_subscriptions.user_id=EXCLUDED.user_id
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'PUSH_ENDPOINT_OWNED_BY_ANOTHER_USER'; END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_push_subscription_owner_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'PUSH_SUBSCRIPTION_OWNER_IMMUTABLE'; END IF; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_push_subscriptions_owner_immutable ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_owner_immutable BEFORE UPDATE ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.prevent_push_subscription_owner_change();

DROP FUNCTION IF EXISTS public.list_resident_attachments(text,uuid);
CREATE FUNCTION public.list_resident_attachments(
  p_parent_type text,p_parent_id uuid,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0
) RETURNS TABLE (id uuid,filename text,content_type text,byte_size integer,created_at timestamptz,total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id,a.filename,a.content_type,a.byte_size,a.created_at,count(*) OVER()
  FROM public.society_attachments a
  WHERE a.archived_at IS NULL
    AND private.auth_membership_role(a.society_id)='resident'
    AND (
      (p_parent_type='document' AND a.document_id=p_parent_id AND EXISTS (
        SELECT 1 FROM public.society_documents d WHERE d.id=a.document_id AND d.society_id=a.society_id AND d.published_to_residents AND d.archived_at IS NULL
      )) OR
      (p_parent_type='notice' AND a.notice_id=p_parent_id AND EXISTS (
        SELECT 1 FROM public.society_notices n WHERE n.id=a.notice_id AND n.society_id=a.society_id AND n.audience IN ('ALL_MEMBERS','RESIDENTS') AND n.published_at<=now() AND n.archived_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now())
      ))
    )
  ORDER BY a.created_at DESC,a.id DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit,20),1),100)
  OFFSET GREATEST(coalesce(p_offset,0),0)
$$;

REVOKE ALL ON FUNCTION public.assert_payable_bills(uuid,uuid,uuid[],numeric), public.confirm_resident_payment(uuid,text,text,bigint,text,text,text), public.approve_resident_payment_claim(uuid,uuid,text), public.record_manual_payment(uuid,uuid,jsonb), public.void_payment_transactional(uuid,uuid,uuid,text), public.reconcile_bank_statement_line(uuid,uuid,uuid,uuid,text,text,uuid), public.upsert_push_subscription(uuid,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_resident_attachments(text,uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_resident_payment(uuid,text,text,bigint,text,text,text), public.approve_resident_payment_claim(uuid,uuid,text), public.record_manual_payment(uuid,uuid,jsonb), public.void_payment_transactional(uuid,uuid,uuid,text), public.reconcile_bank_statement_line(uuid,uuid,uuid,uuid,text,text,uuid), public.upsert_push_subscription(uuid,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_resident_attachments(text,uuid,integer,integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
