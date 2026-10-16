-- ============================================================================
-- Migration 024: Notification Quota Limits, Email Logs & Admin Overrides
-- ============================================================================

-- 1. Default notify_email to FALSE for new registrations (conserves Brevo daily quota)
-- Existing registered users retain their current preference.
ALTER TABLE public.profiles
  ALTER COLUMN notify_email SET DEFAULT false;

-- 2. Update handle_new_user to respect explicit user signup choice
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_notify_email BOOLEAN := false;
BEGIN
  IF (NEW.raw_user_meta_data ->> 'notify_email') IS NOT NULL THEN
    v_notify_email := (NEW.raw_user_meta_data ->> 'notify_email')::boolean;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, phone, notify_email)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', 'User'),
    NEW.raw_user_meta_data ->> 'phone',
    v_notify_email
  )
  ON CONFLICT (email) DO UPDATE SET
    id = NEW.id,
    is_shadow = false,
    claimed_at = now(),
    full_name = COALESCE(NEW.raw_user_meta_data ->> 'full_name', public.profiles.full_name),
    phone = COALESCE(NEW.raw_user_meta_data ->> 'phone', public.profiles.phone);

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 3. Email Logs Table (Tracks per-user and platform 24h dispatch counts)
CREATE TABLE IF NOT EXISTS public.email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  event TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent', 'rate_limited', 'unsubscribed', 'failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_user_status_time
  ON public.email_logs(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_logs_status_time
  ON public.email_logs(status, created_at DESC);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own email logs" ON public.email_logs;
CREATE POLICY "Users can view their own email logs"
  ON public.email_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all email logs" ON public.email_logs;
CREATE POLICY "Admins can view all email logs"
  ON public.email_logs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Service role bypasses RLS automatically when the Edge Function inserts logs.

-- 4. Admin RPC: Toggle user email notification standing
CREATE OR REPLACE FUNCTION public.admin_toggle_user_email_notif(
  p_target_user_id UUID,
  p_enabled BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_is_admin BOOLEAN := false;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles WHERE id = v_caller_id;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin privileges required');
  END IF;

  UPDATE public.profiles
  SET notify_email = p_enabled
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target user profile not found');
  END IF;

  INSERT INTO public.activity_log (user_id, action, details)
  VALUES (
    v_caller_id,
    'ADMIN_USER_EMAIL_NOTIF_CHANGED',
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'notify_email', p_enabled,
      'admin_id', v_caller_id,
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object('success', true, 'notify_email', p_enabled);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_user_email_notif(UUID, BOOLEAN) TO authenticated;

-- 5. Admin RPC: Reset user's 24h email rate limit
CREATE OR REPLACE FUNCTION public.admin_reset_user_email_limit(p_target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_is_admin BOOLEAN := false;
  v_deleted INT := 0;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles WHERE id = v_caller_id;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin privileges required');
  END IF;

  DELETE FROM public.email_logs
  WHERE user_id = p_target_user_id
    AND created_at > now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.activity_log (user_id, action, details)
  VALUES (
    v_caller_id,
    'ADMIN_RESET_USER_EMAIL_LIMIT',
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'cleared_logs_count', v_deleted,
      'admin_id', v_caller_id,
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object('success', true, 'cleared_count', v_deleted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reset_user_email_limit(UUID) TO authenticated;
