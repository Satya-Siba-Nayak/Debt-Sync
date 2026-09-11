-- ═══════════════════════════════════════════════════════════════
-- Support for Default Phone Country Code & Normalized Phone Search
-- ═══════════════════════════════════════════════════════════════

-- Add default_country_code to user_settings (defaulting to +91 India)
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS default_country_code TEXT DEFAULT '+91';

-- Update find_profile_by_identifier to match phone numbers regardless of spacing/formatting
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
     OR (
       p.phone IS NOT NULL 
       AND length(trim(search_term)) >= 6
       AND (
         trim(p.phone) = trim(search_term)
         OR regexp_replace(p.phone, '\D', '', 'g') = regexp_replace(search_term, '\D', '', 'g')
         OR regexp_replace(p.phone, '\D', '', 'g') LIKE '%' || regexp_replace(search_term, '\D', '', 'g')
       )
     )
  LIMIT 1;
$$;
