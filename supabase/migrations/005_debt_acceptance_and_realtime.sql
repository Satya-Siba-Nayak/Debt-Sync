-- ═══════════════════════════════════════════════════════════════
-- 005: Debt Acceptance, Realtime & Shadow Resolution
-- ═══════════════════════════════════════════════════════════════

-- 1. Enable Realtime on debts and payments
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.debts;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- 2. Enhanced RLS for debts (allows counterparties by Auth UID OR by email/secondary match)
DROP POLICY IF EXISTS "debts_select" ON public.debts;
CREATE POLICY "debts_select" ON public.debts FOR SELECT USING (
  lender_id = auth.uid() 
  OR borrower_id = auth.uid()
  OR created_by = auth.uid()
  OR borrower_id IN (
    SELECT p.id FROM public.profiles p 
    WHERE lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       OR lower(coalesce(auth.jwt() ->> 'email', '')) = ANY(SELECT lower(unnest(p.secondary_emails)))
  )
  OR lender_id IN (
    SELECT p.id FROM public.profiles p 
    WHERE lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       OR lower(coalesce(auth.jwt() ->> 'email', '')) = ANY(SELECT lower(unnest(p.secondary_emails)))
  )
);

DROP POLICY IF EXISTS "debts_update" ON public.debts;
CREATE POLICY "debts_update" ON public.debts FOR UPDATE USING (
  lender_id = auth.uid() 
  OR borrower_id = auth.uid()
  OR created_by = auth.uid()
  OR borrower_id IN (
    SELECT p.id FROM public.profiles p 
    WHERE lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       OR lower(coalesce(auth.jwt() ->> 'email', '')) = ANY(SELECT lower(unnest(p.secondary_emails)))
  )
  OR lender_id IN (
    SELECT p.id FROM public.profiles p 
    WHERE lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       OR lower(coalesce(auth.jwt() ->> 'email', '')) = ANY(SELECT lower(unnest(p.secondary_emails)))
  )
);

-- 3. Public/Secure helper to retrieve a debt agreement for review
CREATE OR REPLACE FUNCTION public.get_debt_for_acceptance(p_debt_id UUID)
RETURNS TABLE (
  id UUID,
  created_by UUID,
  lender_id UUID,
  borrower_id UUID,
  principal DECIMAL(12,2),
  currency TEXT,
  interest_type TEXT,
  interest_rate DECIMAL(7,4),
  compound_freq TEXT,
  status TEXT,
  notes TEXT,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  lender_name TEXT,
  lender_email TEXT,
  lender_avatar TEXT,
  borrower_name TEXT,
  borrower_email TEXT,
  borrower_avatar TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    d.id,
    d.created_by,
    d.lender_id,
    d.borrower_id,
    d.principal,
    d.currency,
    d.interest_type,
    d.interest_rate,
    d.compound_freq,
    d.status,
    d.notes,
    d.accepted_at,
    d.created_at,
    lp.full_name AS lender_name,
    lp.email AS lender_email,
    lp.avatar_url AS lender_avatar,
    bp.full_name AS borrower_name,
    bp.email AS borrower_email,
    bp.avatar_url AS borrower_avatar
  FROM public.debts d
  LEFT JOIN public.profiles lp ON d.lender_id = lp.id
  LEFT JOIN public.profiles bp ON d.borrower_id = bp.id
  WHERE d.id = p_debt_id;
$$;

-- 4. Robust RPC function to accept or decline a debt agreement
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
    -- Check if borrower or lender was a shadow profile matching caller's email
    IF EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE (p.id = v_debt.borrower_id OR p.id = v_debt.lender_id)
        AND (
          lower(p.email) = lower(v_user_email)
          OR lower(v_user_email) = ANY(SELECT lower(unnest(p.secondary_emails)))
        )
    ) THEN
      v_is_counterparty := true;
      -- Claim the debt if caller was the shadow party
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

  -- Log action
  INSERT INTO public.activity_log (user_id, debt_id, action, details)
  VALUES (
    v_user_id,
    p_debt_id,
    CASE WHEN p_decision = 'active' THEN 'debt_accepted' ELSE 'debt_declined' END,
    jsonb_build_object('decision', p_decision)
  );

  -- Ensure both parties are mutual contacts
  IF v_debt.lender_id != v_debt.borrower_id THEN
    INSERT INTO public.contacts (owner_id, contact_id)
    VALUES 
      (v_debt.lender_id, v_debt.borrower_id),
      (v_debt.borrower_id, v_debt.lender_id)
    ON CONFLICT (owner_id, contact_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_decision);
END;
$$;
