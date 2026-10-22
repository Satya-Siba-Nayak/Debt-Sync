-- ============================================================================
-- Migration 026: Payment Reminders (Weekly Limits) & Automated 1-Day Due Date Reminders
-- ============================================================================

-- 1. Update activity log notification trigger to include payment reminders and due date reminders
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
    'global_share_enabled',
    'debt_pending_reminder',
    'payment_reminder',
    'due_date_reminder'
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

-- 2. Secure RPC: send_payment_reminder
-- Enforces:
--   - Caller must be authenticated
--   - Caller must be the lender of the debt
--   - Debt status must be 'active'
--   - p_channel must be 'email', 'push', or 'both'
--   - Email quota: at most 2 times in the last 7 days (rolling window)
--   - Push quota: at most 3 times in the last 7 days (rolling window)
CREATE OR REPLACE FUNCTION public.send_payment_reminder(
  p_debt_id UUID,
  p_channel TEXT DEFAULT 'both'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_debt RECORD;
  v_now TIMESTAMPTZ := now();
  v_channel TEXT := LOWER(COALESCE(p_channel, 'both'));
  v_email_count INT := 0;
  v_push_count INT := 0;
  v_channel_to_use TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF v_channel NOT IN ('email', 'push', 'both') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid reminder channel. Must be email, push, or both.');
  END IF;

  SELECT * INTO v_debt
  FROM public.debts
  WHERE id = p_debt_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction agreement not found');
  END IF;

  IF v_debt.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment reminders can only be sent for active agreements');
  END IF;

  IF v_debt.lender_id != v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the lender can send payment reminders for this agreement');
  END IF;

  -- Count reminders in rolling 7-day period
  SELECT COUNT(*) INTO v_email_count
  FROM public.activity_log
  WHERE debt_id = p_debt_id
    AND action = 'payment_reminder'
    AND (COALESCE(details->>'channel', 'both') IN ('email', 'both'))
    AND created_at >= (v_now - interval '7 days');

  SELECT COUNT(*) INTO v_push_count
  FROM public.activity_log
  WHERE debt_id = p_debt_id
    AND action = 'payment_reminder'
    AND (COALESCE(details->>'channel', 'both') IN ('push', 'both'))
    AND created_at >= (v_now - interval '7 days');

  -- Enforce quota limits
  IF v_channel = 'email' AND v_email_count >= 2 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Weekly email reminder limit reached (2/2 already sent in the last 7 days).',
      'email_count', v_email_count,
      'push_count', v_push_count
    );
  END IF;

  IF v_channel = 'push' AND v_push_count >= 3 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Weekly push notification reminder limit reached (3/3 already sent in the last 7 days).',
      'email_count', v_email_count,
      'push_count', v_push_count
    );
  END IF;

  IF v_channel = 'both' THEN
    IF v_email_count >= 2 AND v_push_count >= 3 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Both weekly reminder limits reached (2 emails, 3 push notifications).',
        'email_count', v_email_count,
        'push_count', v_push_count
      );
    ELSIF v_email_count >= 2 THEN
      -- Fallback to push only if email is exhausted
      v_channel_to_use := 'push';
    ELSIF v_push_count >= 3 THEN
      -- Fallback to email only if push is exhausted
      v_channel_to_use := 'email';
    ELSE
      v_channel_to_use := 'both';
    END IF;
  ELSE
    v_channel_to_use := v_channel;
  END IF;

  -- Record in activity log
  INSERT INTO public.activity_log (user_id, debt_id, action, details)
  VALUES (
    v_caller_id,
    p_debt_id,
    'payment_reminder',
    jsonb_build_object(
      'channel', v_channel_to_use,
      'borrower_id', v_debt.borrower_id,
      'lender_id', v_debt.lender_id,
      'amount', v_debt.principal,
      'currency', v_debt.currency,
      'timestamp', v_now
    )
  );

  -- Dispatch notification via pg_net to notify Edge Function
  PERFORM public.dispatch_notification(jsonb_build_object(
    'event', 'payment_reminder',
    'debt_id', p_debt_id,
    'actor_id', v_caller_id,
    'details', jsonb_build_object(
      'channel', v_channel_to_use,
      'amount', v_debt.principal,
      'currency', v_debt.currency,
      'borrower_id', v_debt.borrower_id,
      'lender_id', v_debt.lender_id
    )
  ));

  RETURN jsonb_build_object(
    'success', true,
    'channel', v_channel_to_use,
    'email_count', CASE WHEN v_channel_to_use IN ('email', 'both') THEN v_email_count + 1 ELSE v_email_count END,
    'push_count', CASE WHEN v_channel_to_use IN ('push', 'both') THEN v_push_count + 1 ELSE v_push_count END,
    'email_remaining', GREATEST(0, 2 - (CASE WHEN v_channel_to_use IN ('email', 'both') THEN v_email_count + 1 ELSE v_email_count END)),
    'push_remaining', GREATEST(0, 3 - (CASE WHEN v_channel_to_use IN ('push', 'both') THEN v_push_count + 1 ELSE v_push_count END))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_payment_reminder(UUID, TEXT) TO authenticated;

-- 3. Automated 1-Day Due Date Reminders RPC
-- Scans all active debts with due dates, checks if due date is tomorrow (1 day away),
-- and automatically sends reminder via both Email and Push Notification if not already sent.
CREATE OR REPLACE FUNCTION public.check_and_send_due_date_reminders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_debt RECORD;
  v_sent_count INT := 0;
  v_processed_count INT := 0;
  v_already_sent BOOLEAN;
  v_diff_days INT;
BEGIN
  FOR v_debt IN
    SELECT d.id, d.lender_id, d.borrower_id, d.principal, d.currency, d.due_date, d.notes
    FROM public.debts d
    WHERE d.status = 'active'
      AND d.due_date IS NOT NULL
  LOOP
    v_processed_count := v_processed_count + 1;
    
    -- Calendar day difference
    v_diff_days := (v_debt.due_date::date - v_now::date);

    -- Exactly 1 day away (tomorrow)
    IF v_diff_days = 1 THEN
      -- Check if already notified for this debt
      SELECT EXISTS (
        SELECT 1 FROM public.activity_log
        WHERE debt_id = v_debt.id
          AND action = 'due_date_reminder'
          AND (
            created_at >= (v_now - interval '48 hours')
            OR (details->>'due_date')::text = v_debt.due_date::text
          )
      ) INTO v_already_sent;

      IF NOT v_already_sent THEN
        INSERT INTO public.activity_log (user_id, debt_id, action, details)
        VALUES (
          v_debt.lender_id,
          v_debt.id,
          'due_date_reminder',
          jsonb_build_object(
            'channel', 'both',
            'due_date', v_debt.due_date,
            'amount', v_debt.principal,
            'currency', v_debt.currency,
            'borrower_id', v_debt.borrower_id,
            'lender_id', v_debt.lender_id,
            'timestamp', v_now
          )
        );

        -- Dispatch notification to Edge Function (both Email and Push)
        PERFORM public.dispatch_notification(jsonb_build_object(
          'event', 'due_date_reminder',
          'debt_id', v_debt.id,
          'actor_id', v_debt.lender_id,
          'details', jsonb_build_object(
            'channel', 'both',
            'amount', v_debt.principal,
            'currency', v_debt.currency,
            'due_date', v_debt.due_date,
            'borrower_id', v_debt.borrower_id,
            'lender_id', v_debt.lender_id
          )
        ));

        v_sent_count := v_sent_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'processed_count', v_processed_count,
    'reminders_sent', v_sent_count,
    'checked_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_send_due_date_reminders() TO anon, authenticated, service_role;
