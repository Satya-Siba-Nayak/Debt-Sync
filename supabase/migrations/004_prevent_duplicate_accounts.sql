-- ═══════════════════════════════════════════════════════════════
-- Prevent Duplicate Accounts (Email Aliases & Phone Numbers)
-- ═══════════════════════════════════════════════════════════════

-- 1. Canonicalize email function (removes Gmail dots, +aliases, and standardizes domains)
CREATE OR REPLACE FUNCTION public.canonicalize_email(input_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  clean TEXT;
  parts TEXT[];
  local_part TEXT;
  domain_part TEXT;
BEGIN
  IF input_email IS NULL OR trim(input_email) = '' THEN
    RETURN NULL;
  END IF;
  
  clean := lower(trim(input_email));
  parts := string_to_array(clean, '@');
  
  IF array_length(parts, 1) != 2 THEN
    RETURN clean;
  END IF;
  
  local_part := parts[1];
  domain_part := parts[2];
  
  -- Normalize Google domains
  IF domain_part = 'googlemail.com' THEN
    domain_part := 'gmail.com';
  END IF;
  
  -- Strip + alias
  local_part := split_part(local_part, '+', 1);
  
  -- If Gmail, remove all dots from username
  IF domain_part = 'gmail.com' THEN
    local_part := replace(local_part, '.', '');
  END IF;
  
  RETURN local_part || '@' || domain_part;
END;
$$;

-- 2. Normalize phone function (strips symbols, standardizes Indian 10-digit / 0-prefix to 91XXXXXXXXXX)
CREATE OR REPLACE FUNCTION public.normalize_phone(input_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits TEXT;
BEGIN
  IF input_phone IS NULL OR trim(input_phone) = '' THEN
    RETURN NULL;
  END IF;
  
  digits := regexp_replace(input_phone, '\D', '', 'g');
  
  IF length(digits) = 0 THEN
    RETURN NULL;
  END IF;

  -- 10 digits -> Indian standard 91XXXXXXXXXX
  IF length(digits) = 10 THEN
    RETURN '91' || digits;
  END IF;

  -- 11 digits starting with 0 -> Indian trunk 91XXXXXXXXXX
  IF length(digits) = 11 AND digits LIKE '0%' THEN
    RETURN '91' || substring(digits from 2);
  END IF;

  RETURN digits;
END;
$$;

-- 3. Unique index on canonical email for real accounts
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_canonical_email 
ON public.profiles (public.canonicalize_email(email)) 
WHERE is_shadow = false;

-- 4. Unique index on normalized phone for real accounts
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_normalized_phone 
ON public.profiles (public.normalize_phone(phone)) 
WHERE phone IS NOT NULL AND phone != '' AND is_shadow = false;

-- 5. Updated find_profile_by_identifier with canonical email and normalized phone
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
  WHERE (
    -- Match primary email directly or canonical
    lower(p.email) = lower(trim(search_term))
    OR public.canonicalize_email(p.email) = public.canonicalize_email(search_term)
  )
  OR (
    -- Match any secondary email directly or canonical
    lower(trim(search_term)) = ANY(SELECT lower(unnest(p.secondary_emails)))
    OR public.canonicalize_email(search_term) = ANY(SELECT public.canonicalize_email(unnest(p.secondary_emails)))
  )
  OR (
    -- Match normalized phone or last 10 digits
    p.phone IS NOT NULL 
    AND length(trim(search_term)) >= 6
    AND (
      trim(p.phone) = trim(search_term)
      OR public.normalize_phone(p.phone) = public.normalize_phone(search_term)
      OR (
        length(public.normalize_phone(p.phone)) >= 10
        AND length(public.normalize_phone(search_term)) >= 10
        AND RIGHT(public.normalize_phone(p.phone), 10) = RIGHT(public.normalize_phone(search_term), 10)
      )
    )
  )
  ORDER BY p.is_shadow ASC, p.created_at ASC
  LIMIT 1;
$$;

-- 6. RPC function to verify if an email or phone conflicts with any existing account
CREATE OR REPLACE FUNCTION public.check_identifier_conflict(
  check_email TEXT,
  check_phone TEXT,
  current_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  canon_email TEXT;
  norm_phone TEXT;
  conflicting_user_email TEXT;
  conflicting_user_phone TEXT;
BEGIN
  canon_email := public.canonicalize_email(check_email);
  norm_phone := public.normalize_phone(check_phone);

  -- Check email conflict against primary and secondary emails
  IF canon_email IS NOT NULL AND canon_email != '' THEN
    SELECT p.email INTO conflicting_user_email
    FROM public.profiles p
    WHERE p.is_shadow = false
      AND (current_user_id IS NULL OR p.id != current_user_id)
      AND (
        public.canonicalize_email(p.email) = canon_email
        OR canon_email = ANY(SELECT public.canonicalize_email(unnest(p.secondary_emails)))
      )
    LIMIT 1;

    IF conflicting_user_email IS NOT NULL THEN
      RETURN jsonb_build_object(
        'has_conflict', true,
        'conflict_type', 'email',
        'message', 'An account already exists with this email address or its alias.'
      );
    END IF;
  END IF;

  -- Check phone conflict
  IF norm_phone IS NOT NULL AND norm_phone != '' THEN
    SELECT p.email INTO conflicting_user_phone
    FROM public.profiles p
    WHERE p.is_shadow = false
      AND (current_user_id IS NULL OR p.id != current_user_id)
      AND p.phone IS NOT NULL
      AND (
        public.normalize_phone(p.phone) = norm_phone
        OR (
          length(public.normalize_phone(p.phone)) >= 10
          AND length(norm_phone) >= 10
          AND RIGHT(public.normalize_phone(p.phone), 10) = RIGHT(norm_phone, 10)
        )
      )
    LIMIT 1;

    IF conflicting_user_phone IS NOT NULL THEN
      RETURN jsonb_build_object(
        'has_conflict', true,
        'conflict_type', 'phone',
        'message', 'This phone number is already registered to another account.'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('has_conflict', false);
END;
$$;
