-- Dues notice config.
ALTER TABLE society_config
  ADD COLUMN IF NOT EXISTS dues_notice_title      TEXT    NOT NULL DEFAULT 'Maintenance Dues Reminder',
  ADD COLUMN IF NOT EXISTS dues_notice_payby_days INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS dues_notice_footer     TEXT    NOT NULL DEFAULT
    'Please clear the outstanding dues by the date shown above to avoid late penalty. If you have already paid, kindly share the payment details with the treasurer so our records can be updated. Contact the treasurer for any discrepancy.';
