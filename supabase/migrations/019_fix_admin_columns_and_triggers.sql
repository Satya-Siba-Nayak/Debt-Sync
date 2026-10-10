-- ═══════════════════════════════════════════════════════════════
-- Migration 019: Fix Admin Columns and Anti-Spam Triggers
-- Safe, 100% Idempotent, Zero Downtime, and Zero Data Loss
-- ═══════════════════════════════════════════════════════════════

-- 1. ADD is_super_admin COLUMN TO PROFILES IF NOT EXISTS
-- Ensures any existing triggers or queries referencing is_super_admin execute seamlessly
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false;

-- 2. REPAIR DATABASE TRIGGER FUNCTION FOR ANTI-SPAM
-- Safely bypasses platform administrators without column dependency errors
CREATE OR REPLACE FUNCTION public.check_debt_spam_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_id UUID;
  v_perm JSONB;
BEGIN
  -- Determine target user (the counterparty of the creator)
  IF NEW.created_by = NEW.lender_id THEN
    v_target_id := NEW.borrower_id;
  ELSE
    v_target_id := NEW.lender_id;
  END IF;

  -- Admin bypass (safely checks is_admin and optional is_super_admin)
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.created_by 
      AND (is_admin = true OR COALESCE(is_super_admin, false) = true)
  ) THEN
    RETURN NEW;
  END IF;

  IF v_target_id IS NOT NULL AND v_target_id != NEW.created_by THEN
    v_perm := public.check_can_request_debt(v_target_id, NEW.created_by);
    IF (v_perm->>'allowed')::boolean = false THEN
      RAISE EXCEPTION '%', COALESCE(v_perm->>'message', 'This user declined your previous request. You must connect with them first before sending new transaction requests.')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. ENSURE TRIGGER IS ATTACHED
DROP TRIGGER IF EXISTS trg_check_debt_spam ON public.debts;
CREATE TRIGGER trg_check_debt_spam
BEFORE INSERT ON public.debts
FOR EACH ROW
EXECUTE FUNCTION public.check_debt_spam_on_insert();

-- 4. REPAIR accept_debt RPC FUNCTION
CREATE OR REPLACE FUNCTION public.accept_debt(p_debt_id UUID, p_decision TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_debt RECORD;
  v_is_counterparty BOOLEAN := false;
  v_dec TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be logged in to accept or decline');
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_debt FROM public.debts WHERE id = p_debt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Debt agreement not found');
  END IF;

  -- Validate caller is party to this debt or an administrator
  IF v_debt.lender_id = v_user_id OR v_debt.borrower_id = v_user_id THEN
    v_is_counterparty := true;
  ELSIF EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = v_user_id 
      AND (is_admin = true OR COALESCE(is_super_admin, false) = true)
  ) THEN
    v_is_counterparty := true;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE (p.id = v_debt.borrower_id OR p.id = v_debt.lender_id)
        AND (
          lower(p.email) = lower(v_user_email)
          OR (p.secondary_emails IS NOT NULL AND lower(v_user_email) = ANY(SELECT lower(unnest(p.secondary_emails))))
        )
    ) THEN
      v_is_counterparty := true;
      IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_debt.borrower_id AND (lower(email) = lower(v_user_email) OR (secondary_emails IS NOT NULL AND lower(v_user_email) = ANY(SELECT lower(unnest(secondary_emails)))))) THEN
        UPDATE public.debts SET borrower_id = v_user_id WHERE id = p_debt_id;
      ELSIF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_debt.lender_id AND (lower(email) = lower(v_user_email) OR (secondary_emails IS NOT NULL AND lower(v_user_email) = ANY(SELECT lower(unnest(secondary_emails)))))) THEN
        UPDATE public.debts SET lender_id = v_user_id WHERE id = p_debt_id;
      END IF;
    END IF;
  END IF;

  IF NOT v_is_counterparty THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not a participant in this agreement');
  END IF;

  v_dec := lower(trim(p_decision));

  IF v_dec IN ('active', 'accepted', 'approve') THEN
    UPDATE public.debts
    SET 
      status = 'active',
      accepted_at = now()
    WHERE id = p_debt_id;

    INSERT INTO public.activity_log (user_id, debt_id, action, details)
    VALUES (v_user_id, p_debt_id, 'debt_accepted', jsonb_build_object('decision', 'active'));

    -- Add mutual contacts ONLY on active acceptance
    IF v_debt.lender_id != v_debt.borrower_id THEN
      INSERT INTO public.contacts (owner_id, contact_id)
      VALUES 
        (v_debt.lender_id, v_debt.borrower_id),
        (v_debt.borrower_id, v_debt.lender_id)
      ON CONFLICT (owner_id, contact_id) DO NOTHING;

      -- If there was a pending contact request, resolve it to accepted
      UPDATE public.contact_requests
      SET status = 'accepted', responded_at = now()
      WHERE (
        (sender_id = v_debt.lender_id AND receiver_id = v_debt.borrower_id)
        OR (sender_id = v_debt.borrower_id AND receiver_id = v_debt.lender_id)
      )
      AND status = 'pending';
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'active');
  ELSE
    UPDATE public.debts
    SET status = 'declined'
    WHERE id = p_debt_id;

    INSERT INTO public.activity_log (user_id, debt_id, action, details)
    VALUES (v_user_id, p_debt_id, 'debt_declined', jsonb_build_object('decision', 'declined'));

    -- If declined, remove from contacts if no other active/settled debts exist
    IF NOT EXISTS (
      SELECT 1 FROM public.debts
      WHERE id != p_debt_id
        AND status IN ('active', 'settled')
        AND (
          (lender_id = v_debt.lender_id AND borrower_id = v_debt.borrower_id)
          OR (lender_id = v_debt.borrower_id AND borrower_id = v_debt.lender_id)
        )
    ) THEN
      DELETE FROM public.contacts
      WHERE (owner_id = v_debt.lender_id AND contact_id = v_debt.borrower_id)
         OR (owner_id = v_debt.borrower_id AND contact_id = v_debt.lender_id);
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'declined');
  END IF;
END;
$$;
