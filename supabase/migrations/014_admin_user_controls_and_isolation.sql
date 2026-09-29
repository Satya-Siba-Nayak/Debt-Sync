-- ═══════════════════════════════════════════════════════════════
-- Migration 014: Admin User Controls, Isolation & Moderation
-- Safe, Idempotent, and Warning-Free
-- ═══════════════════════════════════════════════════════════════

-- 1. ADD SECURITY & MODERATION COLUMNS TO PROFILES
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_isolated BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS isolation_reason TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS needs_reverification BOOLEAN DEFAULT false;

-- 2. ADMIN RPC: TOGGLE USER ISOLATION / QUARANTINE
-- When isolated, an account is restricted from new transactions or payment submissions
CREATE OR REPLACE FUNCTION public.admin_toggle_user_isolation(
  target_user_id UUID,
  isolate BOOLEAN,
  reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_is_admin BOOLEAN;
BEGIN
  -- Strict Admin check
  SELECT COALESCE(is_admin, false) INTO v_caller_is_admin
  FROM public.profiles WHERE id = auth.uid();

  IF NOT v_caller_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Administrator privileges required.');
  END IF;

  UPDATE public.profiles
  SET 
    is_isolated = isolate,
    isolation_reason = CASE WHEN isolate THEN COALESCE(reason, 'Isolated by platform administrator for security review.') ELSE NULL END
  WHERE id = target_user_id;

  IF FOUND THEN
    -- Log administrative action
    INSERT INTO public.activity_log (user_id, action, details)
    VALUES (
      auth.uid(),
      CASE WHEN isolate THEN 'ADMIN_USER_ISOLATED' ELSE 'ADMIN_USER_RESTORED' END,
      jsonb_build_object(
        'target_user_id', target_user_id,
        'isolated', isolate,
        'reason', reason,
        'timestamp', now()
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'message', CASE WHEN isolate THEN 'User account placed in isolation.' ELSE 'User account restored from isolation.' END
    );
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'User profile not found.');
  END IF;
END;
$$;

-- 3. ADMIN RPC: TOGGLE USER VERIFICATION STATUS
CREATE OR REPLACE FUNCTION public.admin_toggle_user_verification(
  target_user_id UUID,
  verified BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_is_admin BOOLEAN;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_caller_is_admin
  FROM public.profiles WHERE id = auth.uid();

  IF NOT v_caller_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Administrator privileges required.');
  END IF;

  UPDATE public.profiles
  SET 
    is_verified = verified,
    needs_reverification = false
  WHERE id = target_user_id;

  IF FOUND THEN
    INSERT INTO public.activity_log (user_id, action, details)
    VALUES (
      auth.uid(),
      CASE WHEN verified THEN 'ADMIN_USER_VERIFIED' ELSE 'ADMIN_USER_UNVERIFIED' END,
      jsonb_build_object('target_user_id', target_user_id, 'verified', verified, 'timestamp', now())
    );

    RETURN jsonb_build_object(
      'success', true,
      'message', CASE WHEN verified THEN 'User marked as Admin-Verified.' ELSE 'User verification cleared.' END
    );
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'User profile not found.');
  END IF;
END;
$$;

-- 4. ADMIN RPC: FORCE REVERIFICATION
CREATE OR REPLACE FUNCTION public.admin_force_reverification(
  target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_is_admin BOOLEAN;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_caller_is_admin
  FROM public.profiles WHERE id = auth.uid();

  IF NOT v_caller_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Administrator privileges required.');
  END IF;

  UPDATE public.profiles
  SET 
    needs_reverification = true,
    is_verified = false
  WHERE id = target_user_id;

  IF FOUND THEN
    INSERT INTO public.activity_log (user_id, action, details)
    VALUES (
      auth.uid(),
      'ADMIN_FORCE_REVERIFICATION',
      jsonb_build_object('target_user_id', target_user_id, 'timestamp', now())
    );

    RETURN jsonb_build_object('success', true, 'message', 'Reverification requirement flagged for user.');
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'User profile not found.');
  END IF;
END;
$$;

-- 5. ADMIN RPC: PURGE / DELETE USER ACCOUNT (WITH AUDIT)
CREATE OR REPLACE FUNCTION public.admin_delete_user(
  target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_is_admin BOOLEAN;
  v_target_email TEXT;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_caller_is_admin
  FROM public.profiles WHERE id = auth.uid();

  IF NOT v_caller_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Administrator privileges required.');
  END IF;

  -- Prevent self-deletion via admin tool
  IF target_user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Administrators cannot purge their own account via this tool.');
  END IF;

  SELECT email INTO v_target_email FROM public.profiles WHERE id = target_user_id;

  -- Cleanup user relational data
  DELETE FROM public.user_settings WHERE user_id = target_user_id;
  DELETE FROM public.contacts WHERE owner_id = target_user_id OR contact_id = target_user_id;
  DELETE FROM public.contact_requests WHERE sender_id = target_user_id OR receiver_id = target_user_id;
  
  -- Soft-clear references in debts or purge shadow profile
  DELETE FROM public.profiles WHERE id = target_user_id;

  INSERT INTO public.activity_log (user_id, action, details)
  VALUES (
    auth.uid(),
    'ADMIN_USER_PURGED',
    jsonb_build_object(
      'target_user_id', target_user_id,
      'target_email', v_target_email,
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object('success', true, 'message', 'User account successfully purged.');
END;
$$;

-- 6. PREVENT ISOLATED ACCOUNTS FROM RECORDING NEW TRANSACTIONS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'debts' AND policyname = 'prevent_isolated_user_debts'
  ) THEN
    CREATE POLICY "prevent_isolated_user_debts" ON public.debts
      FOR INSERT WITH CHECK (
        NOT COALESCE(
          (SELECT is_isolated FROM public.profiles WHERE id = auth.uid()),
          false
        )
      );
  END IF;
END $$;
