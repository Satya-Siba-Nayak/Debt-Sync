-- ============================================================================
-- Migration 023: Background Push + Email Notifications
-- ============================================================================
-- Flow: DB trigger -> pg_net HTTP POST -> Edge Function `notify`
--       -> Brevo (email) + Web Push (VAPID) to every subscribed device.
-- Delivery happens server-side, so it works even when the site is closed.
-- ============================================================================

-- 0. HTTP-from-Postgres extension (used to call the Edge Function)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 1. Email opt-out preference (push is controlled per-device by (un)subscribing)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_email BOOLEAN DEFAULT TRUE;

-- 2. Push subscriptions (one row per browser/device)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  last_used_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subs_select_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_select_own" ON public.push_subscriptions
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subs_delete_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_delete_own" ON public.push_subscriptions
  FOR DELETE USING (user_id = auth.uid());

-- Inserts/updates go through register_push_subscription() so a device that
-- switches accounts is re-assigned to the new user instead of hitting RLS.

CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_endpoint IS NULL OR p_p256dh IS NULL OR p_auth IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid subscription');
  END IF;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
  VALUES (v_user_id, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), now())
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    last_used_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_push_subscription(p_endpoint TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.push_subscriptions
  WHERE endpoint = p_endpoint AND user_id = auth.uid();
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_subscription(TEXT) TO authenticated;

-- 3. Private config (Edge Function URL + shared secret). RLS on, NO policies:
--    unreachable through the public API, readable only by SECURITY DEFINER code.
CREATE TABLE IF NOT EXISTS public.notification_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE public.notification_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_config FROM anon, authenticated;

-- 4. Dispatcher: fire-and-forget POST to the Edge Function. NEVER blocks or
--    fails the originating insert (errors are swallowed into a warning).
CREATE OR REPLACE FUNCTION public.dispatch_notification(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM public.notification_config WHERE key = 'edge_function_url';
  SELECT value INTO v_secret FROM public.notification_config WHERE key = 'webhook_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN; -- not configured yet: silently skip
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := p_payload
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'dispatch_notification failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_notification(JSONB) FROM PUBLIC, anon, authenticated;

-- 5. Trigger: new debt rows (covers single debts AND every split-bill share)
CREATE OR REPLACE FUNCTION public.trg_debts_insert_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('declined', 'purged') THEN
    RETURN NEW;
  END IF;

  PERFORM public.dispatch_notification(jsonb_build_object(
    'event', 'debt_inserted',
    'debt_id', NEW.id,
    'actor_id', NEW.created_by
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debts_insert_notify ON public.debts;
CREATE TRIGGER trg_debts_insert_notify
  AFTER INSERT ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.trg_debts_insert_notify();

-- 6. Trigger: meaningful activity_log actions (counterparty of the actor is notified)
--    debt_created / debt_split_created are intentionally excluded: the debts
--    INSERT trigger above already covers them (avoids duplicate alerts).
CREATE OR REPLACE FUNCTION public.trg_activity_log_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.action NOT IN (
    'repayment_reported',
    'payment_made',
    'payment_verified',
    'payment_disputed',
    'debt_accepted',
    'debt_declined',
    'debt_pending_edited',
    'debt_cancelled_by_creator',
    'global_share_enabled'
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.dispatch_notification(jsonb_build_object(
    'event', NEW.action,
    'log_id', NEW.id,
    'debt_id', NEW.debt_id,
    'actor_id', NEW.user_id,
    'details', COALESCE(NEW.details, '{}'::jsonb)
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activity_log_notify ON public.activity_log;
CREATE TRIGGER trg_activity_log_notify
  AFTER INSERT ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_log_notify();

-- ============================================================================
-- AFTER deploying the Edge Function, run ONCE (replace both values):
--
--   INSERT INTO public.notification_config (key, value) VALUES
--     ('edge_function_url', 'https://<PROJECT_REF>.supabase.co/functions/v1/notify'),
--     ('webhook_secret',    '<same random string you set as WEBHOOK_SECRET secret>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- ============================================================================
