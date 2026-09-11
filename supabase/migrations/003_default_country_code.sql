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
         OR regexp_replace(search_term, '\D', '', 'g') LIKE '%' || regexp_replace(p.phone, '\D', '', 'g')
         OR (
           length(regexp_replace(p.phone, '\D', '', 'g')) >= 10 
           AND length(regexp_replace(search_term, '\D', '', 'g')) >= 10
           AND RIGHT(regexp_replace(p.phone, '\D', '', 'g'), 10) = RIGHT(regexp_replace(search_term, '\D', '', 'g'), 10)
         )
       )
     )
  LIMIT 1;
$$;

-- OPTIONAL: Normalize existing 10-digit phone numbers in profiles table without country header to '+91 '
-- Run this if you want existing legacy numbers to have +91 header in the database:
-- UPDATE public.profiles 
-- SET phone = '+91 ' || trim(phone) 
-- WHERE phone IS NOT NULL 
--   AND phone !~ '^\+' 
--   AND length(regexp_replace(phone, '\D', '', 'g')) = 10;
