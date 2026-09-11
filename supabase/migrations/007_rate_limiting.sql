-- ═══════════════════════════════════════════════════════════════
-- Migration 007: Background Rate Limiting, Abuse Protections & Account Status Check
-- ═══════════════════════════════════════════════════════════════

-- 1. RATE LIMIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.rate_limit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL, -- 'signup', 'magic_link', 'password_reset'
  identifier TEXT,      -- canonical email or phone
  ip_address TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for ultra-fast sliding window queries
CREATE INDEX IF NOT EXISTS idx_rate_limit_session_action ON public.rate_limit_logs (session_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_ip_action ON public.rate_limit_logs (ip_address, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_identifier_action ON public.rate_limit_logs (identifier, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_created_at ON public.rate_limit_logs (created_at);

-- RLS: protect from direct tampering; all interactions go through SECURITY DEFINER RPC
ALTER TABLE public.rate_limit_logs ENABLE ROW LEVEL SECURITY;

-- 2. RATE LIMIT EVALUATOR & RECORDER RPC
CREATE OR REPLACE FUNCTION public.check_and_record_rate_limit(
  p_action TEXT,
  p_identifier TEXT DEFAULT NULL,
  p_ip_address TEXT DEFAULT '127.0.0.1',
  p_session_id TEXT DEFAULT 'anonymous'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count INT;
  v_canon_identifier TEXT := NULL;
BEGIN
  IF p_identifier IS NOT NULL AND TRIM(p_identifier) != '' THEN
    v_canon_identifier := public.canonicalize_email(p_identifier);
    IF v_canon_identifier IS NULL THEN
      v_canon_identifier := LOWER(TRIM(p_identifier));
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- A. SIGNUP RATE LIMITS
  -- ═══════════════════════════════════════════════════════════════
  IF p_action = 'signup' THEN
    -- Rule 1: Browser session hourly limit (max 3 accounts in 1 hour)
    SELECT COUNT(*) INTO v_count
    FROM public.rate_limit_logs
    WHERE session_id = p_session_id
      AND action = 'signup'
      AND created_at > now() - INTERVAL '1 hour';

    IF v_count >= 3 THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'session_hourly_limit',
        'message', 'Too many accounts created from this browser session. Maximum 3 accounts per hour allowed. Please try again later.'
      );
    END IF;

    -- Rule 2: Browser session daily limit (max 5 accounts in 24 hours)
    SELECT COUNT(*) INTO v_count
    FROM public.rate_limit_logs
    WHERE session_id = p_session_id
      AND action = 'signup'
      AND created_at > now() - INTERVAL '24 hours';

    IF v_count >= 5 THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'session_daily_limit',
        'message', 'Daily account creation limit reached for this browser session (max 5/day). Please try again tomorrow.'
      );
    END IF;

    -- Rule 3: Network IP daily limit (max 10 accounts in 24 hours)
    IF p_ip_address IS NOT NULL AND p_ip_address NOT IN ('127.0.0.1', '::1', 'localhost', '') THEN
      SELECT COUNT(*) INTO v_count
      FROM public.rate_limit_logs
      WHERE ip_address = p_ip_address
        AND action = 'signup'
        AND created_at > now() - INTERVAL '24 hours';

      IF v_count >= 10 THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'ip_daily_limit',
          'message', 'Too many accounts created from this network IP address today (max 10/day). Please try again tomorrow.'
        );
      END IF;
    END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- B. EMAIL DISPATCH LIMITS (Magic Link & Password Reset)
  -- ═══════════════════════════════════════════════════════════════
  ELSIF p_action IN ('magic_link', 'password_reset') THEN
    -- Rule 1: Target Email 6-hour limit (max 5 emails per 6 hours)
    IF v_canon_identifier IS NOT NULL AND v_canon_identifier != '' THEN
      SELECT COUNT(*) INTO v_count
      FROM public.rate_limit_logs
      WHERE identifier = v_canon_identifier
        AND action IN ('magic_link', 'password_reset')
        AND created_at > now() - INTERVAL '6 hours';

      IF v_count >= 5 THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'email_target_limit',
          'message', 'Rate limit reached: Maximum 5 security emails allowed every 6 hours for this email. Please check your inbox or try again in a few hours.'
        );
      END IF;
    END IF;

    -- Rule 2: Browser session 6-hour email flooding limit (max 8 emails per 6 hours)
    SELECT COUNT(*) INTO v_count
    FROM public.rate_limit_logs
    WHERE session_id = p_session_id
      AND action IN ('magic_link', 'password_reset')
      AND created_at > now() - INTERVAL '6 hours';

    IF v_count >= 8 THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'session_email_limit',
        'message', 'Too many email requests from this browser session. Please try again later.'
      );
    END IF;

    -- Rule 3: Network IP 6-hour email flooding limit (max 10 emails per 6 hours)
    IF p_ip_address IS NOT NULL AND p_ip_address NOT IN ('127.0.0.1', '::1', 'localhost', '') THEN
      SELECT COUNT(*) INTO v_count
      FROM public.rate_limit_logs
      WHERE ip_address = p_ip_address
        AND action IN ('magic_link', 'password_reset')
        AND created_at > now() - INTERVAL '6 hours';

      IF v_count >= 10 THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'ip_email_limit',
          'message', 'Too many email requests from this network. Please try again later.'
        );
      END IF;
    END IF;
  END IF;

  -- Record attempt atomically
  INSERT INTO public.rate_limit_logs (action, identifier, ip_address, session_id)
  VALUES (p_action, v_canon_identifier, p_ip_address, p_session_id);

  RETURN jsonb_build_object('allowed', true);
END;
$$;

-- 3. CHECK ACCOUNT STATUS FOR LOGIN / MAGIC LINK
-- Verifies whether an email belongs to a primary account, secondary alias, or is non-existent
CREATE OR REPLACE FUNCTION public.check_account_status_for_login(p_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_cleaned TEXT;
  v_canon TEXT;
  v_primary_email TEXT;
  v_is_shadow BOOLEAN;
BEGIN
  IF p_identifier IS NULL OR TRIM(p_identifier) = '' THEN
    RETURN jsonb_build_object('status', 'invalid', 'message', 'Please enter a valid email address.');
  END IF;

  v_cleaned := LOWER(TRIM(p_identifier));
  v_canon := public.canonicalize_email(v_cleaned);
  IF v_canon IS NULL THEN
    v_canon := v_cleaned;
  END IF;

  -- 1. Check if matches primary email in public.profiles (exact or canonical)
  SELECT email, is_shadow INTO v_primary_email, v_is_shadow
  FROM public.profiles
  WHERE LOWER(email) = v_cleaned
     OR public.canonicalize_email(email) = v_canon
  LIMIT 1;

  IF v_primary_email IS NOT NULL THEN
    IF v_is_shadow THEN
      RETURN jsonb_build_object(
        'status', 'shadow',
        'primary_email', v_primary_email,
        'message', 'This email has recorded peer debts but has not completed account signup yet.'
      );
    END IF;

    RETURN jsonb_build_object(
      'status', 'primary',
      'primary_email', v_primary_email
    );
  END IF;

  -- 2. Check if matches secondary email in public.profiles
  SELECT email INTO v_primary_email
  FROM public.profiles
  WHERE is_shadow = false
    AND (
      v_cleaned = ANY(SELECT LOWER(unnest(secondary_emails)))
      OR v_canon = ANY(SELECT public.canonicalize_email(unnest(secondary_emails)))
    )
  LIMIT 1;

  IF v_primary_email IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'secondary',
      'primary_email', v_primary_email,
      'message', 'This email is registered as a secondary/alternate email for an account.'
    );
  END IF;

  -- 3. Not found
  RETURN jsonb_build_object(
    'status', 'not_found',
    'message', 'No account found with this email address.'
  );
END;
$$;

-- 4. GRANT PERMISSIONS
GRANT EXECUTE ON FUNCTION public.check_and_record_rate_limit(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_account_status_for_login(TEXT) TO anon, authenticated, service_role;
