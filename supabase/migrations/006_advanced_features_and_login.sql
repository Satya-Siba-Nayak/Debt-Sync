-- ═══════════════════════════════════════════════════════════════
-- Migration 006: Due Date, Login Identifier Resolver, & Storage Bucket
-- ═══════════════════════════════════════════════════════════════

-- 1. ADD DUE_DATE COLUMN TO DEBTS
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;

-- 2. RESOLVE LOGIN IDENTIFIER RPC (Password Login with Secondary Email or Phone)
-- Allows an unauthenticated login attempt to map a phone number or secondary email
-- back to the primary auth.users email address so Supabase signInWithPassword succeeds.
CREATE OR REPLACE FUNCTION public.resolve_login_identifier(p_identifier TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_cleaned TEXT;
  v_digits TEXT;
  v_primary_email TEXT;
BEGIN
  IF p_identifier IS NULL OR TRIM(p_identifier) = '' THEN
    RETURN NULL;
  END IF;

  v_cleaned := LOWER(TRIM(p_identifier));

  -- Step A: Direct match on primary email in public.profiles
  SELECT email INTO v_primary_email
  FROM public.profiles
  WHERE LOWER(email) = v_cleaned
  LIMIT 1;

  IF v_primary_email IS NOT NULL THEN
    RETURN v_primary_email;
  END IF;

  -- Step B: Match inside secondary_emails array in public.profiles
  SELECT email INTO v_primary_email
  FROM public.profiles
  WHERE v_cleaned = ANY(
    SELECT LOWER(unnest(secondary_emails))
  )
  LIMIT 1;

  IF v_primary_email IS NOT NULL THEN
    RETURN v_primary_email;
  END IF;

  -- Step C: Match by Phone Number (match exact or last 10 digits)
  v_digits := regexp_replace(v_cleaned, '[^\d]', '', 'g');
  IF LENGTH(v_digits) >= 7 THEN
    -- Try match where stripped phone ends with or contains digits
    SELECT email INTO v_primary_email
    FROM public.profiles
    WHERE regexp_replace(phone, '[^\d]', '', 'g') LIKE '%' || v_digits || '%'
       OR (LENGTH(v_digits) >= 10 AND regexp_replace(phone, '[^\d]', '', 'g') = RIGHT(v_digits, 10))
    LIMIT 1;

    IF v_primary_email IS NOT NULL THEN
      RETURN v_primary_email;
    END IF;
  END IF;

  -- Fallback: return original identifier (e.g. if it's already an email in auth.users)
  RETURN v_cleaned;
END;
$$;

-- Grant execution to anon (unauthenticated) and authenticated users
GRANT EXECUTE ON FUNCTION public.resolve_login_identifier(TEXT) TO anon, authenticated;

-- 3. STORAGE BUCKET FOR PROFILE PICTURES
-- Create the public avatars bucket if it doesn't already exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS Policies
DO $$
BEGIN
  -- Allow public viewing of avatars
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Public Avatar Read'
  ) THEN
    CREATE POLICY "Public Avatar Read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');
  END IF;

  -- Allow authenticated users to upload avatar
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Authenticated Avatar Upload'
  ) THEN
    CREATE POLICY "Authenticated Avatar Upload"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'avatars');
  END IF;

  -- Allow authenticated users to update their avatar
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Authenticated Avatar Update'
  ) THEN
    CREATE POLICY "Authenticated Avatar Update"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'avatars');
  END IF;
END $$;
