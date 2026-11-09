-- Roles v2.
ALTER TABLE profiles         DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE resident_invites DROP CONSTRAINT IF EXISTS resident_invites_role_check;

UPDATE profiles         SET role = 'treasurer' WHERE role = 'admin';
UPDATE resident_invites SET role = 'treasurer' WHERE role = 'admin';

ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'treasurer', 'committee', 'auditor', 'resident'));
ALTER TABLE resident_invites ADD CONSTRAINT resident_invites_role_check
  CHECK (role IN ('owner', 'treasurer', 'committee', 'auditor', 'resident'));

-- ── Permission-tier helpers (STABLE — cached per statement, see 032 for the
--    call-site wrapping that actually realises the caching) ─────────────────────
CREATE OR REPLACE FUNCTION public.auth_write_tier()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'treasurer');
END;
$$;

CREATE OR REPLACE FUNCTION public.auth_read_tier()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'treasurer', 'committee', 'auditor');
END;
$$;

CREATE OR REPLACE FUNCTION public.auth_profile_society_id()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (SELECT society_id FROM public.profiles WHERE id = auth.uid());
END;
$$;
