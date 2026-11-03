-- ═══════════════════════════════════════════════════════════════
-- Migration 029: Payment Verification RLS Policies & Hardened RPC
-- Fixes:
-- 1. Missing FOR UPDATE / FOR DELETE RLS policies on public.payments
-- 2. Resilient verify_repayment RPC with flexible signatures & ghost/admin support
-- 3. Batch verify_all_repayments RPC for bulk repayments
-- 4. Preserves payment receipts on debt settlement (no destructive orphan purge)
-- ═══════════════════════════════════════════════════════════════

-- 1. ADD RLS POLICIES FOR PAYMENTS UPDATE & DELETE
DO $$
BEGIN
  -- Drop existing if conflicting
  DROP POLICY IF EXISTS "payments_update" ON public.payments;
  DROP POLICY IF EXISTS "payments_delete" ON public.payments;
END $$;

-- Allow authenticated users who are either lender or borrower of the debt (or an admin) to update payments
CREATE POLICY "payments_update" ON public.payments
  FOR UPDATE TO authenticated
  USING (
    debt_id IN (
      SELECT id FROM public.debts
      WHERE lender_id = auth.uid() OR borrower_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (COALESCE(p.is_admin, false) = true OR COALESCE(p.is_super_admin, false) = true)
    )
  )
  WITH CHECK (
    debt_id IN (
      SELECT id FROM public.debts
      WHERE lender_id = auth.uid() OR borrower_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (COALESCE(p.is_admin, false) = true OR COALESCE(p.is_super_admin, false) = true)
    )
  );

-- Allow lender, the payer, or an admin to delete a payment if necessary
CREATE POLICY "payments_delete" ON public.payments
  FOR DELETE TO authenticated
  USING (
    debt_id IN (
      SELECT id FROM public.debts
      WHERE lender_id = auth.uid()
    )
    OR paid_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (COALESCE(p.is_admin, false) = true OR COALESCE(p.is_super_admin, false) = true)
    )
  );

-- 2. HARDEN verify_repayment RPC
DROP FUNCTION IF EXISTS public.verify_repayment(UUID);
DROP FUNCTION IF EXISTS public.verify_repayment(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.verify_repayment(UUID, TEXT);
DROP FUNCTION IF EXISTS public.verify_repayment(UUID, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.verify_repayment(
  p_payment_id UUID,
  p_decision TEXT DEFAULT 'accepted',
  p_should_settle BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_payment RECORD;
  v_debt RECORD;
  v_total_verified NUMERIC(15, 2) := 0;
  v_days_elapsed NUMERIC := 0;
  v_years NUMERIC := 0;
  v_periods_per_year NUMERIC := 12;
  v_total_obligation NUMERIC(15, 2) := 0;
  v_settled BOOLEAN := false;
  v_disputed_note TEXT;
  v_decision TEXT;
  v_is_lender BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment record not found');
  END IF;

  SELECT * INTO v_debt FROM public.debts WHERE id = v_payment.debt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Associated debt not found');
  END IF;

  -- Check if caller is authorized (direct lender, lender profile owner via email/phone, or platform admin)
  IF v_debt.lender_id = v_user_id THEN
    v_is_lender := true;
  ELSE
    -- Check admin status
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = v_user_id AND (COALESCE(is_admin, false) = true OR COALESCE(is_super_admin, false) = true)
    ) THEN
      v_is_lender := true;
    ELSE
      -- Check secondary email or ghost-profile matching
      IF EXISTS (
        SELECT 1 FROM public.profiles lp
        JOIN public.profiles up ON up.id = v_user_id
        WHERE lp.id = v_debt.lender_id
          AND (
            lp.email = up.email
            OR lp.email = ANY(COALESCE(up.secondary_emails, '{}'::text[]))
            OR (lp.phone IS NOT NULL AND lp.phone = up.phone)
          )
      ) THEN
        v_is_lender := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_is_lender THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the lender or an administrator can verify or dispute repayments');
  END IF;

  v_decision := lower(trim(COALESCE(p_decision, 'accepted')));

  -- ─── Dispute / Decline Path ───
  IF v_decision IN ('declined', 'disputed', 'reject', 'dispute') THEN
    v_disputed_note := COALESCE(v_payment.note, '');
    IF v_disputed_note NOT LIKE '%[DISPUTED]%' THEN
      IF length(trim(v_disputed_note)) > 0 THEN
        v_disputed_note := v_disputed_note || ' [DISPUTED]';
      ELSE
        v_disputed_note := 'Disputed by lender [DISPUTED]';
      END IF;
    END IF;

    UPDATE public.payments
    SET
      is_verified = false,
      verified_by = v_user_id,
      verified_at = NOW(),
      note = v_disputed_note
    WHERE id = p_payment_id;

    INSERT INTO public.activity_log (debt_id, user_id, action, details)
    VALUES (
      v_debt.id,
      v_user_id,
      'payment_disputed',
      jsonb_build_object(
        'payment_id', p_payment_id,
        'amount', v_payment.amount,
        'note', v_disputed_note,
        'disputed_by', v_user_id
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'disputed', true,
      'debt_settled', false
    );
  END IF;

  -- ─── Accept / Verify Path ───
  UPDATE public.payments
  SET
    is_verified = true,
    verified_by = v_user_id,
    verified_at = NOW()
  WHERE id = p_payment_id;

  -- Calculate total verified payments for this debt
  SELECT COALESCE(SUM(amount), 0) INTO v_total_verified
  FROM public.payments
  WHERE debt_id = v_debt.id AND is_verified = true;

  -- Determine whether debt should be settled
  IF p_should_settle IS NOT NULL THEN
    v_settled := p_should_settle;
  ELSE
    IF v_debt.interest_type = 'none' OR COALESCE(v_debt.interest_rate, 0) <= 0 THEN
      v_total_obligation := v_debt.principal;
    ELSE
      v_days_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(v_debt.start_date, v_debt.created_at))) / 86400.0);
      v_years := v_days_elapsed / 365.25;
      IF v_debt.interest_type = 'simple' THEN
        v_total_obligation := ROUND(v_debt.principal * (1 + (v_debt.interest_rate / 100.0) * v_years), 2);
      ELSIF v_debt.interest_type = 'compound' THEN
        v_periods_per_year := CASE v_debt.compound_freq
          WHEN 'daily' THEN 365.25
          WHEN 'weekly' THEN 52.1775
          WHEN 'monthly' THEN 12.0
          WHEN 'yearly' THEN 1.0
          ELSE 12.0
        END;
        v_total_obligation := ROUND(
          v_debt.principal * POWER(1 + (v_debt.interest_rate / 100.0) / v_periods_per_year, v_periods_per_year * v_years),
          2
        );
      ELSE
        v_total_obligation := v_debt.principal;
      END IF;
    END IF;

    v_settled := v_total_verified >= (v_total_obligation - 0.01);
  END IF;

  IF v_settled AND v_debt.status != 'settled' THEN
    UPDATE public.debts
    SET status = 'settled', settled_at = NOW(), updated_at = NOW()
    WHERE id = v_debt.id;
  END IF;

  -- Log verification event
  INSERT INTO public.activity_log (debt_id, user_id, action, details)
  VALUES (
    v_debt.id,
    v_user_id,
    'payment_verified',
    jsonb_build_object(
      'payment_id', p_payment_id,
      'amount', v_payment.amount,
      'debt_settled', v_settled,
      'verified_by', v_user_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'verified', true,
    'debt_settled', v_settled,
    'total_verified', v_total_verified
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 2-argument overload so legacy or simpler callers never encounter signature mismatches
CREATE OR REPLACE FUNCTION public.verify_repayment(
  p_payment_id UUID,
  p_decision TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RETURN public.verify_repayment(p_payment_id, p_decision, NULL);
END;
$$;

-- 3. BATCH VERIFICATION RPC: verify_all_repayments
CREATE OR REPLACE FUNCTION public.verify_all_repayments(
  p_payment_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_pid UUID;
  v_verified_count INTEGER := 0;
  v_last_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_payment_ids IS NULL OR array_length(p_payment_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', true, 'verified_count', 0);
  END IF;

  FOREACH v_pid IN ARRAY p_payment_ids LOOP
    v_last_res := public.verify_repayment(v_pid, 'accepted', NULL);
    IF (v_last_res->>'success')::boolean = true THEN
      v_verified_count := v_verified_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'verified_count', v_verified_count,
    'total_requested', array_length(p_payment_ids, 1)
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 4. PERMISSIONS
GRANT EXECUTE ON FUNCTION public.verify_repayment(UUID, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_repayment(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_all_repayments(UUID[]) TO authenticated, service_role;
