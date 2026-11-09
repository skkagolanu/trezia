-- Society id default.

CREATE OR REPLACE FUNCTION public.default_society_id()
RETURNS uuid LANGUAGE sql STABLE
SET search_path = public
AS $$ SELECT id FROM societies ORDER BY created_at LIMIT 1 $$;

ALTER TABLE society_config        ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE units                 ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE residents             ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE payments              ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE bills                 ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE expenditures          ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE other_income          ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE balance_snapshots     ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE amc_collections       ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE treasurer_handovers   ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE levy_configs          ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE profiles              ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE resident_invites      ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE opening_balances      ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE fund_ledger_entries   ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE advance_settlements   ALTER COLUMN society_id SET DEFAULT default_society_id();
ALTER TABLE bank_statement_batches ALTER COLUMN society_id SET DEFAULT default_society_id();
