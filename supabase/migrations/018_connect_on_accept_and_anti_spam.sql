-- Migration 018: Connect on Accept, Anti-Spam Rejection Gate & Frictionless First Request

-- 1. Function to check if caller can request a debt from target user
CREATE OR REPLACE FUNCTION public.check_can_request_debt(
  p_target_id UUID,
  p_caller_override UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_id UUID;
  v_is_contact BOOLEAN := false;
  v_has_active_debts BOOLEAN := false;
  v_declined_count INT := 0;
  v_last_declined_at TIMESTAMPTZ := NULL;
  v_contact_req RECORD;
  v_rec RECORD;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_caller_id := auth.uid();
  ELSE
    v_caller_id := p_caller_override;
  END IF;

  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  IF p_target_id IS NULL OR p_target_id = v_caller_id THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  -- 1. Check if target is already in caller's contacts
  SELECT EXISTS (
    SELECT 1 FROM public.contacts 
    WHERE owner_id = v_caller_id AND contact_id = p_target_id
  ) INTO v_is_contact;

  IF v_is_contact THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'requires_connection', false,
      'is_contact', true
    );
  END IF;

  -- 2. Check if they have ANY active or settled debts together
  SELECT EXISTS (
    SELECT 1 FROM public.debts
    WHERE (
      (lender_id = v_caller_id AND borrower_id = p_target_id)
      OR (borrower_id = v_caller_id AND lender_id = p_target_id)
    )
    AND status IN ('active', 'settled')
  ) INTO v_has_active_debts;

  IF v_has_active_debts THEN
    -- Established transaction history
    RETURN jsonb_build_object(
      'allowed', true,
      'requires_connection', false,
      'has_history', true
    );
  END IF;

  -- 3. Check if target user has declined ANY debt created by caller
  FOR v_rec IN 
    SELECT id, status, created_at
    FROM public.debts
    WHERE created_by = v_caller_id
      AND (
        (lender_id = v_caller_id AND borrower_id = p_target_id)
        OR (borrower_id = v_caller_id AND lender_id = p_target_id)
      )
    ORDER BY created_at DESC
  LOOP
    IF v_rec.status IN ('active', 'settled') THEN
      EXIT;
    ELSIF v_rec.status = 'declined' THEN
      v_declined_count := v_declined_count + 1;
      IF v_last_declined_at IS NULL THEN
        v_last_declined_at := v_rec.created_at;
      END IF;
    END IF;
  END LOOP;

  -- If target user previously declined caller's debt:
  IF v_declined_count > 0 THEN
    -- Check contact_requests table
    SELECT id, status INTO v_contact_req
    FROM public.contact_requests
    WHERE sender_id = v_caller_id AND receiver_id = p_target_id
    LIMIT 1;

    IF FOUND THEN
      IF v_contact_req.status = 'accepted' THEN
        -- Contact request was accepted! Ensure mutual contacts exist.
        INSERT INTO public.contacts (owner_id, contact_id)
        VALUES 
          (v_caller_id, p_target_id),
          (p_target_id, v_caller_id)
        ON CONFLICT (owner_id, contact_id) DO NOTHING;

        RETURN jsonb_build_object(
          'allowed', true,
          'requires_connection', false,
          'contact_request_status', 'accepted'
        );
      ELSIF v_contact_req.status = 'pending' THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'requires_connection', true,
          'contact_request_status', 'pending',
          'contact_request_id', v_contact_req.id,
          'declined_count', v_declined_count,
          'reason', 'connect_pending',
          'code', 'ERR_CONNECT_REQUEST_PENDING',
          'message', 'This person declined your previous request. Your connection request is currently pending their approval.'
        );
      ELSIF v_contact_req.status = 'declined' THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'requires_connection', true,
          'contact_request_status', 'declined',
          'contact_request_id', v_contact_req.id,
          'declined_count', v_declined_count,
          'reason', 'connect_declined',
          'code', 'ERR_CONNECT_REQUEST_DECLINED',
          'message', 'This person declined your transaction and declined to connect. To protect user privacy, you cannot send requests to them.'
        );
      END IF;
    END IF;

    -- No contact request sent yet:
    RETURN jsonb_build_object(
      'allowed', false,
      'requires_connection', true,
      'contact_request_status', 'none',
      'declined_count', v_declined_count,
      'reason', 'must_connect',
      'code', 'ERR_MUST_CONNECT_FIRST',
      'message', 'This person declined your previous request. To prevent spam, you must send a connection request and be accepted as a contact before sending new transaction requests.'
    );
  END IF;

  -- 4. No previous declines (First interaction):
  RETURN jsonb_build_object(
    'allowed', true,
    'requires_connection', false,
    'first_interaction', true
  );
END;
$$;

-- 2. Update accept_debt RPC to guarantee mutual contact creation
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
    WHERE id = v_user_id AND is_admin = true
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

-- 3. Database Trigger: Enforce Anti-Spam Gate on direct INSERT
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

  -- Admin bypass
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.created_by AND is_admin = true
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

DROP TRIGGER IF EXISTS trg_check_debt_spam ON public.debts;
CREATE TRIGGER trg_check_debt_spam
BEFORE INSERT ON public.debts
FOR EACH ROW
EXECUTE FUNCTION public.check_debt_spam_on_insert();
