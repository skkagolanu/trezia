-- Fix receipt trigger.
CREATE OR REPLACE FUNCTION assign_receipt_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_id     UUID;
  v_prefix TEXT;
  v_next   INTEGER;
BEGIN
  IF NEW.receipt_number IS NULL THEN
    SELECT id, receipt_prefix, next_receipt_no
    INTO   v_id, v_prefix, v_next
    FROM   society_config
    LIMIT  1
    FOR UPDATE;

    NEW.receipt_number       = v_prefix || '-' || LPAD(v_next::TEXT, 4, '0');
    NEW.receipt_generated_at = NOW();

    UPDATE society_config
    SET    next_receipt_no = next_receipt_no + 1
    WHERE  id = v_id;
  END IF;
  RETURN NEW;
END;
$$;
