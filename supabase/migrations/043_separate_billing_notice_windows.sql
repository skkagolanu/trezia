-- Separate billing notice windows.
ALTER TABLE public.society_config
  ADD COLUMN IF NOT EXISTS maintenance_payment_window_days integer NOT NULL DEFAULT 7;

UPDATE public.society_config
SET maintenance_payment_window_days = dues_notice_payby_days;

ALTER TABLE public.society_config
  DROP CONSTRAINT IF EXISTS society_config_maintenance_payment_window_days_check;

ALTER TABLE public.society_config
  ADD CONSTRAINT society_config_maintenance_payment_window_days_check
  CHECK (maintenance_payment_window_days BETWEEN 0 AND 365);

UPDATE public.bills AS bill
SET due_date = make_date(bill.bill_period_year, bill.bill_period_month, 1)
  + GREATEST(config.maintenance_payment_window_days - 1, 0)
FROM public.society_config AS config
WHERE bill.society_id = config.society_id
  AND bill.status = 'ISSUED'
  AND NOT bill.is_voided
  AND make_date(bill.bill_period_year, bill.bill_period_month, 1)
      >= date_trunc('month', CURRENT_DATE)::date;
