-- Operating layer.

ALTER TABLE public.expenditures ADD CONSTRAINT expenditures_id_society_unique UNIQUE (id, society_id);
ALTER TABLE public.society_notices ADD CONSTRAINT society_notices_id_society_unique UNIQUE (id, society_id);
ALTER TABLE public.society_notices
  ADD COLUMN category text NOT NULL DEFAULT 'GENERAL'
    CHECK (category IN ('GENERAL','MAINTENANCE','SAFETY','EVENT','FINANCE','GOVERNANCE')),
  ADD COLUMN audience text NOT NULL DEFAULT 'ALL_MEMBERS'
    CHECK (audience IN ('ALL_MEMBERS','RESIDENTS','OPERATORS')),
  ADD COLUMN is_pinned boolean NOT NULL DEFAULT false;

CREATE TABLE public.society_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  category text NOT NULL CHECK (category IN ('BYLAWS','REGISTRATION','AUDIT_REPORT','AGM_MINUTES','CIRCULAR','FORM','CONTRACT','OTHER')),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  document_date date,
  published_to_residents boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, society_id)
);

CREATE TABLE public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  service_category text NOT NULL CHECK (char_length(btrim(service_category)) BETWEEN 2 AND 100),
  contact_name text CHECK (contact_name IS NULL OR char_length(contact_name) <= 150),
  phone text CHECK (phone IS NULL OR phone ~ '^[0-9+ ()-]{7,20}$'),
  email text CHECK (email IS NULL OR char_length(email) <= 254),
  address text CHECK (address IS NULL OR char_length(address) <= 500),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  archived_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, society_id)
);

CREATE TABLE public.vendor_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  contract_value numeric(12,2) CHECK (contract_value IS NULL OR contract_value >= 0),
  start_date date,
  end_date date,
  renewal_notice_days integer NOT NULL DEFAULT 30 CHECK (renewal_notice_days BETWEEN 0 AND 365),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','EXPIRED','TERMINATED')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  archived_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, society_id),
  CONSTRAINT vendor_contracts_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT vendor_contracts_vendor_same_society FOREIGN KEY (vendor_id, society_id)
    REFERENCES public.vendors(id, society_id) ON DELETE RESTRICT
);

CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  vendor_id uuid,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  category text NOT NULL CHECK (char_length(btrim(category)) BETWEEN 2 AND 100),
  location text CHECK (location IS NULL OR char_length(location) <= 200),
  purchase_date date,
  warranty_expires_on date,
  next_service_date date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','UNDER_REPAIR','OUT_OF_SERVICE','RETIRED')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  archived_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, society_id),
  CONSTRAINT assets_vendor_same_society FOREIGN KEY (vendor_id, society_id)
    REFERENCES public.vendors(id, society_id) ON DELETE RESTRICT
);

CREATE TABLE public.asset_service_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL,
  vendor_id uuid,
  service_date date NOT NULL,
  next_service_date date,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 2 AND 1000),
  amount numeric(12,2) CHECK (amount IS NULL OR amount >= 0),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  archived_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, society_id),
  CONSTRAINT asset_services_dates CHECK (next_service_date IS NULL OR next_service_date >= service_date),
  CONSTRAINT asset_services_asset_same_society FOREIGN KEY (asset_id, society_id)
    REFERENCES public.assets(id, society_id) ON DELETE RESTRICT,
  CONSTRAINT asset_services_vendor_same_society FOREIGN KEY (vendor_id, society_id)
    REFERENCES public.vendors(id, society_id) ON DELETE RESTRICT
);

CREATE TABLE public.operational_expense_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  expenditure_id uuid NOT NULL,
  vendor_contract_id uuid,
  asset_id uuid,
  asset_service_record_id uuid,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (id, society_id),
  CONSTRAINT operational_link_exactly_one_parent CHECK (
    num_nonnulls(vendor_contract_id, asset_id, asset_service_record_id) = 1
  ),
  CONSTRAINT operational_link_expense_same_society FOREIGN KEY (expenditure_id, society_id)
    REFERENCES public.expenditures(id, society_id) ON DELETE RESTRICT,
  CONSTRAINT operational_link_contract_same_society FOREIGN KEY (vendor_contract_id, society_id)
    REFERENCES public.vendor_contracts(id, society_id) ON DELETE RESTRICT,
  CONSTRAINT operational_link_asset_same_society FOREIGN KEY (asset_id, society_id)
    REFERENCES public.assets(id, society_id) ON DELETE RESTRICT,
  CONSTRAINT operational_link_service_same_society FOREIGN KEY (asset_service_record_id, society_id)
    REFERENCES public.asset_service_records(id, society_id) ON DELETE RESTRICT
);

CREATE TABLE public.society_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  document_id uuid,
  vendor_contract_id uuid,
  asset_id uuid,
  asset_service_record_id uuid,
  notice_id uuid,
  filename text NOT NULL CHECK (char_length(btrim(filename)) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (content_type IN ('application/pdf','image/jpeg','image/png')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  object_key text NOT NULL UNIQUE,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (id, society_id),
  CONSTRAINT attachment_exactly_one_parent CHECK (
    num_nonnulls(document_id, vendor_contract_id, asset_id, asset_service_record_id, notice_id) = 1
  ),
  CONSTRAINT attachment_document_same_society FOREIGN KEY (document_id, society_id)
    REFERENCES public.society_documents(id, society_id) ON DELETE RESTRICT,
  CONSTRAINT attachment_contract_same_society FOREIGN KEY (vendor_contract_id, society_id)
    REFERENCES public.vendor_contracts(id, society_id) ON DELETE RESTRICT,
  CONSTRAINT attachment_asset_same_society FOREIGN KEY (asset_id, society_id)
    REFERENCES public.assets(id, society_id) ON DELETE RESTRICT,
  CONSTRAINT attachment_service_same_society FOREIGN KEY (asset_service_record_id, society_id)
    REFERENCES public.asset_service_records(id, society_id) ON DELETE RESTRICT,
  CONSTRAINT attachment_notice_same_society FOREIGN KEY (notice_id, society_id)
    REFERENCES public.society_notices(id, society_id) ON DELETE RESTRICT,
  CONSTRAINT attachment_canonical_key CHECK (object_key = 'attachments/' || society_id::text || '/' || id::text)
);

CREATE INDEX society_documents_list_idx ON public.society_documents (society_id, archived_at, document_date DESC, id DESC);
CREATE INDEX vendors_list_idx ON public.vendors (society_id, archived_at, name, id);
CREATE INDEX vendor_contracts_renewal_idx ON public.vendor_contracts (society_id, archived_at, end_date, id);
CREATE INDEX vendor_contracts_list_idx ON public.vendor_contracts (society_id, archived_at, created_at DESC, id DESC);
CREATE INDEX assets_service_idx ON public.assets (society_id, archived_at, next_service_date, id);
CREATE INDEX assets_warranty_idx ON public.assets (society_id, archived_at, warranty_expires_on, id);
CREATE INDEX assets_list_idx ON public.assets (society_id, archived_at, created_at DESC, id DESC);
CREATE INDEX asset_service_records_list_idx ON public.asset_service_records (society_id, asset_id, service_date DESC, id DESC);
CREATE INDEX operational_expense_links_expense_idx ON public.operational_expense_links (society_id, expenditure_id);
CREATE INDEX society_attachments_parent_idx ON public.society_attachments (society_id, document_id, vendor_contract_id, asset_id, asset_service_record_id, notice_id);

CREATE OR REPLACE FUNCTION public.prevent_operational_hard_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'OPERATIONAL_RECORDS_ARCHIVE_ONLY';
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['society_documents','vendors','vendor_contracts','assets','asset_service_records'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%I_ts BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()', table_name, table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['society_documents','vendors','vendor_contracts','assets','asset_service_records','operational_expense_links','society_attachments'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%I_no_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_operational_hard_delete()', table_name, table_name);
    EXECUTE format('CREATE TRIGGER trg_%I_audit AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_audit_event()', table_name, table_name);
  END LOOP;
END $$;
CREATE TRIGGER trg_society_notices_audit AFTER INSERT OR UPDATE ON public.society_notices
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

ALTER TABLE public.society_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_service_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_expense_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.society_attachments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['society_documents','vendors','vendor_contracts','assets','asset_service_records','operational_expense_links','society_attachments'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.auth_society_finance(society_id) OR private.auth_platform_suspended_read(society_id))', table_name || '_operator_select', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (private.auth_society_finance(society_id) AND created_by = (SELECT auth.uid()))', table_name || '_operator_insert', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (private.auth_society_finance(society_id)) WITH CHECK (private.auth_society_finance(society_id))', table_name || '_operator_update', table_name);
  END LOOP;
END $$;

-- Residents receive fixed safe projections through these functions. They have no
-- table policy, so direct PostgREST selects cannot expose object keys, authors,
-- hashes, internal parent columns, or future operator-only columns.
CREATE OR REPLACE FUNCTION public.list_resident_documents(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS TABLE (id uuid, title text, category text, description text, document_date date, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.id, d.title, d.category, d.description, d.document_date, d.created_at
  FROM public.society_documents d
  WHERE private.auth_membership_role(d.society_id) = 'resident'
    AND d.published_to_residents AND d.archived_at IS NULL
  ORDER BY d.created_at DESC, d.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

CREATE OR REPLACE FUNCTION public.list_resident_attachments(p_parent_type text, p_parent_id uuid)
RETURNS TABLE (id uuid, filename text, content_type text, byte_size integer, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.filename, a.content_type, a.byte_size, a.created_at
  FROM public.society_attachments a
  WHERE a.archived_at IS NULL
    AND private.auth_membership_role(a.society_id) = 'resident'
    AND (
      (p_parent_type = 'document' AND a.document_id = p_parent_id AND EXISTS (
        SELECT 1 FROM public.society_documents d WHERE d.id = a.document_id AND d.society_id = a.society_id AND d.published_to_residents AND d.archived_at IS NULL
      )) OR
      (p_parent_type = 'notice' AND a.notice_id = p_parent_id AND EXISTS (
        SELECT 1 FROM public.society_notices n WHERE n.id = a.notice_id AND n.society_id = a.society_id AND n.audience IN ('ALL_MEMBERS','RESIDENTS') AND n.published_at <= now() AND n.archived_at IS NULL AND (n.expires_at IS NULL OR n.expires_at > now())
      ))
    )
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT 100
$$;

CREATE OR REPLACE FUNCTION public.get_resident_attachment(p_attachment_id uuid)
RETURNS TABLE (id uuid, filename text, content_type text, byte_size integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.filename, a.content_type, a.byte_size
  FROM public.society_attachments a
  WHERE a.id = p_attachment_id AND a.archived_at IS NULL
    AND private.auth_membership_role(a.society_id) = 'resident'
    AND (
      EXISTS (SELECT 1 FROM public.society_documents d WHERE d.id = a.document_id AND d.society_id = a.society_id AND d.published_to_residents AND d.archived_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.society_notices n WHERE n.id = a.notice_id AND n.society_id = a.society_id AND n.audience IN ('ALL_MEMBERS','RESIDENTS') AND n.published_at <= now() AND n.archived_at IS NULL AND (n.expires_at IS NULL OR n.expires_at > now()))
    )
$$;

REVOKE ALL ON FUNCTION public.list_resident_documents(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_resident_attachments(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_resident_attachment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_resident_documents(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_resident_attachments(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_resident_attachment(uuid) TO authenticated;

DROP POLICY IF EXISTS society_notices_resident_select ON public.society_notices;
CREATE POLICY society_notices_resident_select ON public.society_notices FOR SELECT TO authenticated
USING (private.auth_membership_role(society_id) = 'resident' AND audience IN ('ALL_MEMBERS','RESIDENTS') AND published_at <= now() AND archived_at IS NULL AND (expires_at IS NULL OR expires_at > now()));

NOTIFY pgrst, 'reload schema';
