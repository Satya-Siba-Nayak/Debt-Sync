-- ═══════════════════════════════════════════════════════════════
-- Support for Secondary Emails (College, Work) and Unified Lookup
-- ═══════════════════════════════════════════════════════════════

-- Add secondary_emails array to profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS secondary_emails TEXT[] DEFAULT '{}';

-- Create an index to quickly find profiles by any secondary email
CREATE INDEX IF NOT EXISTS idx_profiles_secondary_emails ON profiles USING GIN (secondary_emails);

-- Helper function to find a profile by ANY identifier: primary email, secondary email, or phone
CREATE OR REPLACE FUNCTION public.find_profile_by_identifier(search_term TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  is_shadow BOOLEAN,
  secondary_emails TEXT[]
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT p.id, p.email, p.full_name, p.phone, p.is_shadow, p.secondary_emails
  FROM public.profiles p
  WHERE lower(p.email) = lower(trim(search_term))
     OR lower(trim(search_term)) = ANY(SELECT lower(unnest(p.secondary_emails)))
     OR (p.phone IS NOT NULL AND trim(p.phone) != '' AND trim(p.phone) = trim(search_term))
  LIMIT 1;
$$;
