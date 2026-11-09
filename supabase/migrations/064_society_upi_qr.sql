-- Society upi qr.

ALTER TABLE public.society_config
  ADD COLUMN IF NOT EXISTS upi_qr_object_key text;

NOTIFY pgrst, 'reload schema';
