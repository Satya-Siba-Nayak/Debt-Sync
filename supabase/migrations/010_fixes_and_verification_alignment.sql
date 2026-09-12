-- ═══════════════════════════════════════════════════════════════
-- Migration 010: Database Integrity, Flexible Decisions & Alignment
-- Safe, Idempotent, Warning-Free for Supabase SQL Editor
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

-- Enable Realtime safely (only if publication exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_requests;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN OTHERS THEN NULL;
END $$;

-- 2. ENSURE DEBTS & PAYMENTS COLUMNS EXIST
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS counterparty_notes TEXT;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS hidden_by UUID[] DEFAULT '{}';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT true;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.profiles(id);

-- 3. ENHANCED REPAYMENT VERIFICATION RPC
-- Supports 'accepted', 'verified', 'declined', 'disputed'
CREATE OR REPLACE FUNCTION public.verify_repayment(
  p_payment_id UUID,
  p_decision TEXT
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
  v_dec TEXT;
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

  v_dec := lower(trim(p_decision));

  IF v_dec IN ('accepted', 'verified', 'approve') THEN
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

    RETURN jsonb_build_object('success', true, 'decision', 'accepted');
  ELSE
    -- Lender disputes / declines payment
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

    RETURN jsonb_build_object('success', true, 'decision', 'declined');
  END IF;
END;
$$;

-- 4. ENHANCED ACCEPT_DEBT RPC
-- Supports 'active', 'accepted', 'declined', 'rejected'
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

  -- Validate caller is party to this debt
  IF v_debt.lender_id = v_user_id OR v_debt.borrower_id = v_user_id THEN
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

-- 5. CONTACT REQUEST RESPOND RPC
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
  v_dec TEXT;
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

  v_dec := lower(trim(p_decision));

  UPDATE public.contact_requests
  SET 
    status = v_dec,
    responded_at = now()
  WHERE id = p_request_id;

  IF v_dec IN ('accepted', 'approve') THEN
    INSERT INTO public.contacts (owner_id, contact_id)
    VALUES 
      (v_req.sender_id, v_req.receiver_id),
      (v_req.receiver_id, v_req.sender_id)
    ON CONFLICT (owner_id, contact_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', v_dec);
END;
$$;
