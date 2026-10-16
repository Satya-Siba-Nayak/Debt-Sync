-- ============================================================================
-- Migration 025: Pending Debt Reminders & Quota Guard
-- ============================================================================

-- 1. Add reminder tracking columns to debts table
ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;

-- 2. Include 'debt_pending_reminder' in activity log notifications trigger
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
    'debt_pending_reminder'
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

-- 3. Secure RPC: send_debt_pending_reminder
-- Enforces:
--   - Caller must be the debt creator / lender
--   - Status must be 'pending'
--   - At least 24 hours must have elapsed since creation
--   - Max 2 reminders allowed per debt agreement
--   - At most 1 reminder per 24 hours (1/day)
CREATE OR REPLACE FUNCTION public.send_debt_pending_reminder(p_debt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_debt RECORD;
  v_now TIMESTAMPTZ := now();
  v_new_count INT;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_debt
  FROM public.debts
  WHERE id = p_debt_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction agreement not found');
  END IF;

  IF v_debt.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reminders can only be sent for pending transactions');
  END IF;

  IF v_debt.created_by != v_caller_id AND v_debt.lender_id != v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the transaction creator/lender can send reminders');
  END IF;

  -- Must be at least 24h after posting
  IF v_debt.created_at > (v_now - interval '24 hours') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'First reminder is available 24 hours after posting the transaction',
      'available_at', v_debt.created_at + interval '24 hours'
    );
  END IF;

  -- Max 2 reminders allowed
  IF COALESCE(v_debt.reminder_count, 0) >= 2 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Maximum reminder limit reached (2 reminders already sent for this transaction)'
    );
  END IF;

  -- Rate limit: at most 1 reminder per 24 hours
  IF v_debt.last_reminder_at IS NOT NULL AND v_debt.last_reminder_at > (v_now - interval '24 hours') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only 1 reminder allowed per 24 hours. Please wait before sending another.',
      'available_at', v_debt.last_reminder_at + interval '24 hours'
    );
  END IF;

  v_new_count := COALESCE(v_debt.reminder_count, 0) + 1;

  UPDATE public.debts
  SET reminder_count = v_new_count,
      last_reminder_at = v_now
  WHERE id = p_debt_id;

  -- Record in activity log
  INSERT INTO public.activity_log (user_id, debt_id, action, details)
  VALUES (
    v_caller_id,
    p_debt_id,
    'debt_pending_reminder',
    jsonb_build_object(
      'reminder_number', v_new_count,
      'borrower_id', v_debt.borrower_id,
      'lender_id', v_debt.lender_id,
      'timestamp', v_now
    )
  );

  -- Dispatch notification via pg_net to notify Edge Function
  PERFORM public.dispatch_notification(jsonb_build_object(
    'event', 'debt_pending_reminder',
    'debt_id', p_debt_id,
    'actor_id', v_caller_id,
    'details', jsonb_build_object('reminder_number', v_new_count)
  ));

  RETURN jsonb_build_object(
    'success', true,
    'reminder_count', v_new_count,
    'last_reminder_at', v_now,
    'reminders_remaining', 2 - v_new_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_debt_pending_reminder(UUID) TO authenticated;
