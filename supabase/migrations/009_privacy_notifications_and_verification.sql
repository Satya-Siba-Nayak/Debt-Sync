-- ═══════════════════════════════════════════════════════════════
-- Migration 009: Privacy, Contact Nudges, Two-Sided Notes & Repayment Verification
-- ═══════════════════════════════════════════════════════════════

-- 1. CONTACT REQUESTS TABLE
CREATE TABLE IF NOT EXISTS public.contact_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  responded_at    TIMESTAMPTZ,
  UNIQUE(sender_id, receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_requests_receiver ON public.contact_requests(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_contact_requests_sender ON public.contact_requests(sender_id, status);

ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_requests_select" ON public.contact_requests;
CREATE POLICY "contact_requests_select" ON public.contact_requests FOR SELECT USING (
  sender_id = auth.uid() OR receiver_id = auth.uid()
);

DROP POLICY IF EXISTS "contact_requests_insert" ON public.contact_requests;
CREATE POLICY "contact_requests_insert" ON public.contact_requests FOR INSERT WITH CHECK (
  sender_id = auth.uid()
);

DROP POLICY IF EXISTS "contact_requests_update" ON public.contact_requests;
CREATE POLICY "contact_requests_update" ON public.contact_requests FOR UPDATE USING (
  receiver_id = auth.uid() OR sender_id = auth.uid()
);

-- Enable Realtime for contact_requests
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_requests;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- 2. CONTACT REQUEST RESPOND RPC
CREATE OR REPLACE FUNCTION public.respond_to_contact_request(
  p_request_id UUID,
  p_decision TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req RECORD;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_req FROM public.contact_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contact request not found');
  END IF;

  IF v_req.receiver_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the recipient can respond to this request');
  END IF;

  UPDATE public.contact_requests
  SET 
    status = p_decision,
    responded_at = now()
  WHERE id = p_request_id;

  IF p_decision = 'accepted' THEN
    -- Insert mutual contacts
    INSERT INTO public.contacts (owner_id, contact_id)
    VALUES 
      (v_req.sender_id, v_req.receiver_id),
      (v_req.receiver_id, v_req.sender_id)
    ON CONFLICT (owner_id, contact_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_decision);
END;
$$;

-- 3. ENHANCE DEBTS TABLE (Two-Sided Notes & Hidden UI Dismissal)
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS counterparty_notes TEXT;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS hidden_by UUID[] DEFAULT '{}';

-- 4. ENHANCE PAYMENTS TABLE (Lender Verification & Settlement)
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT true;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.profiles(id);

-- 5. REPAYMENT VERIFICATION RPC
CREATE OR REPLACE FUNCTION public.verify_repayment(
  p_payment_id UUID,
  p_decision TEXT -- 'accepted' or 'declined'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_payment RECORD;
  v_debt RECORD;
  v_total_verified NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  SELECT * INTO v_debt FROM public.debts WHERE id = v_payment.debt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Associated debt not found');
  END IF;

  -- Only lender can verify repayments
  IF v_debt.lender_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the lender can verify repayments');
  END IF;

  IF p_decision = 'accepted' THEN
    UPDATE public.payments
    SET 
      is_verified = true,
      verified_at = now(),
      verified_by = v_user_id
    WHERE id = p_payment_id;

    -- Compute total verified payments
    SELECT COALESCE(SUM(amount), 0) INTO v_total_verified
    FROM public.payments
    WHERE debt_id = v_debt.id AND is_verified = true;

    -- If total verified payments meet or exceed principal, settle debt
    IF v_total_verified >= v_debt.principal THEN
      UPDATE public.debts
      SET 
        status = 'settled',
        settled_at = now()
      WHERE id = v_debt.id;
    END IF;

    -- Log verification
    INSERT INTO public.activity_log (user_id, debt_id, action, details)
    VALUES (
      v_user_id,
      v_debt.id,
      'payment_verified',
      jsonb_build_object('payment_id', p_payment_id, 'amount', v_payment.amount)
    );
  ELSE
    -- If lender declines the payment, mark as unverified and record in activity log
    UPDATE public.payments
    SET 
      is_verified = false,
      verified_at = now(),
      verified_by = v_user_id
    WHERE id = p_payment_id;

    INSERT INTO public.activity_log (user_id, debt_id, action, details)
    VALUES (
      v_user_id,
      v_debt.id,
      'payment_disputed',
      jsonb_build_object('payment_id', p_payment_id, 'amount', v_payment.amount)
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'decision', p_decision);
END;
$$;

-- 6. REFINED ACCEPT_DEBT (Strict Mutual Contacts on Accept Only)
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

  -- Validate caller is party to this debt
  IF v_debt.lender_id = v_user_id OR v_debt.borrower_id = v_user_id THEN
    v_is_counterparty := true;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE (p.id = v_debt.borrower_id OR p.id = v_debt.lender_id)
        AND (
          lower(p.email) = lower(v_user_email)
          OR lower(v_user_email) = ANY(SELECT lower(unnest(p.secondary_emails)))
        )
    ) THEN
      v_is_counterparty := true;
      IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_debt.borrower_id AND (lower(email) = lower(v_user_email) OR lower(v_user_email) = ANY(SELECT lower(unnest(secondary_emails))))) THEN
        UPDATE public.debts SET borrower_id = v_user_id WHERE id = p_debt_id;
      ELSIF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_debt.lender_id AND (lower(email) = lower(v_user_email) OR lower(v_user_email) = ANY(SELECT lower(unnest(secondary_emails))))) THEN
        UPDATE public.debts SET lender_id = v_user_id WHERE id = p_debt_id;
      END IF;
    END IF;
  END IF;

  IF NOT v_is_counterparty THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not a participant in this agreement');
  END IF;

  -- Update debt status
  UPDATE public.debts
  SET 
    status = p_decision,
    accepted_at = CASE WHEN p_decision = 'active' THEN now() ELSE accepted_at END
  WHERE id = p_debt_id;

  -- Log action in activity log
  INSERT INTO public.activity_log (user_id, debt_id, action, details)
  VALUES (
    v_user_id,
    p_debt_id,
    CASE WHEN p_decision = 'active' THEN 'debt_accepted' ELSE 'debt_declined' END,
    jsonb_build_object('decision', p_decision)
  );

  -- Ensure both parties are mutual contacts ONLY when ACCEPTED
  IF p_decision = 'active' AND v_debt.lender_id != v_debt.borrower_id THEN
    INSERT INTO public.contacts (owner_id, contact_id)
    VALUES 
      (v_debt.lender_id, v_debt.borrower_id),
      (v_debt.borrower_id, v_debt.lender_id)
    ON CONFLICT (owner_id, contact_id) DO NOTHING;
  END IF;

  -- When DECLINED: ensure unaccepted contact relationship is deleted if no other active debts exist
  IF p_decision = 'declined' THEN
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
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_decision);
END;
$$;

-- 7. ANTI-HARASSMENT COOLDOWN CHECK RPC
CREATE OR REPLACE FUNCTION public.check_debt_request_cooldown(p_target_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_id UUID;
  v_declined_count INT := 0;
  v_last_declined_at TIMESTAMPTZ := NULL;
  v_cooldown_duration INTERVAL;
  v_cooldown_until TIMESTAMPTZ;
  v_rec RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  IF p_target_id IS NULL OR p_target_id = v_caller_id THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  -- Check consecutive declined requests from caller to target since last accepted agreement
  FOR v_rec IN 
    SELECT status, created_at
    FROM public.debts
    WHERE created_by = v_caller_id
      AND (
        (lender_id = v_caller_id AND borrower_id = p_target_id)
        OR (borrower_id = v_caller_id AND lender_id = p_target_id)
      )
    ORDER BY created_at DESC
  LOOP
    -- An active or settled debt resets the decline streak
    IF v_rec.status IN ('active', 'settled') THEN
      EXIT;
    ELSIF v_rec.status = 'declined' THEN
      v_declined_count := v_declined_count + 1;
      IF v_last_declined_at IS NULL THEN
        v_last_declined_at := v_rec.created_at;
      END IF;
    END IF;
  END LOOP;

  -- Rule:
  -- < 3 declines: Allowed
  -- = 3 declines: 3-day cooldown
  -- >= 4 declines: 1-month (30-day) cooldown
  IF v_declined_count >= 4 THEN
    v_cooldown_duration := INTERVAL '30 days';
    v_cooldown_until := v_last_declined_at + v_cooldown_duration;
    IF now() < v_cooldown_until THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'cooldown_30d',
        'code', 'ERR_DEBT_REQUEST_COOLDOWN_30D',
        'declined_count', v_declined_count,
        'cooldown_until', v_cooldown_until,
        'message', 'This user has declined your requests multiple times. To protect user privacy, you cannot request them again for 1 month.'
      );
    END IF;
  ELSIF v_declined_count = 3 THEN
    v_cooldown_duration := INTERVAL '3 days';
    v_cooldown_until := v_last_declined_at + v_cooldown_duration;
    IF now() < v_cooldown_until THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'cooldown_3d',
        'code', 'ERR_DEBT_REQUEST_COOLDOWN_3D',
        'declined_count', v_declined_count,
        'cooldown_until', v_cooldown_until,
        'message', 'This user declined your previous 3 requests. To protect user privacy, you cannot request them again for 3 days.'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'declined_count', v_declined_count,
    'remaining_attempts', CASE WHEN v_declined_count < 3 THEN 3 - v_declined_count ELSE 1 END
  );
END;
$$;
