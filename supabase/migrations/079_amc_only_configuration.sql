-- Amc only configuration.

UPDATE public.levy_configs
SET is_active_for_new_collections = false
WHERE is_active_for_new_collections = true
  AND levy_label !~ '^AMC-20[0-9]{2}$';

ALTER TABLE public.levy_configs
  DROP CONSTRAINT IF EXISTS levy_configs_active_amc_year;
ALTER TABLE public.levy_configs
  ADD CONSTRAINT levy_configs_active_amc_year
  CHECK (
    is_active_for_new_collections = false
    OR levy_label ~ '^AMC-20[0-9]{2}$'
  );

COMMENT ON CONSTRAINT levy_configs_active_amc_year ON public.levy_configs IS
  'New configuration uses one AMC label per four-digit year; historical labels stay intact for audit and payment completion.';

NOTIFY pgrst, 'reload schema';
