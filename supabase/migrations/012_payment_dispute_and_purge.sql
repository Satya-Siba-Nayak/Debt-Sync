-- ═══════════════════════════════════════════════════════════════
-- Migration 012: Payment Dispute Alignment & Settlement Purge
-- Safe, Idempotent, and Warning-Free
-- ═══════════════════════════════════════════════════════════════

-- 1. ENHANCED REPAYMENT VERIFICATION RPC WITH ORPHAN PURGE
CREATE OR REPLACE FUNCTION public.verify_repayment(
  p_payment_id UUID,
  p_decision TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
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

    -- If total verified payments meet or exceed principal (or within 0.01 threshold), settle debt
    IF v_total_verified >= (v_debt.principal - 0.01) THEN
      UPDATE public.debts
      SET 
        status = 'settled',
        settled_at = now()
      WHERE id = v_debt.id;

      -- PURGE any lingering unverified pending payments for this settled debt!
      DELETE FROM public.payments
      WHERE debt_id = v_debt.id AND is_verified = false;
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
    -- Lender disputes / declines repayment claim
    UPDATE public.payments
    SET 
      is_verified = false,
      verified_at = now(),
      verified_by = v_user_id,
      note = CASE 
        WHEN note IS NULL OR note = '' THEN 'Disputed by lender [DISPUTED]'
        WHEN note LIKE '%[DISPUTED]%' THEN note 
        ELSE note || ' [DISPUTED]' 
      END
    WHERE id = p_payment_id;

    INSERT INTO public.activity_log (user_id, debt_id, action, details)
    VALUES (
      v_user_id,
      v_debt.id,
      'payment_disputed',
      jsonb_build_object('payment_id', p_payment_id, 'amount', v_payment.amount, 'disputed_by', v_user_id)
    );

    RETURN jsonb_build_object('success', true, 'decision', 'disputed');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_repayment(UUID, TEXT) TO authenticated;

-- 2. PURGE ORPHANED PENDING PAYMENTS FOR SETTLED DEBTS
CREATE OR REPLACE FUNCTION public.purge_settled_debt_orphaned_payments()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  -- Delete unverified payments where the debt is already settled
  DELETE FROM public.payments
  WHERE is_verified = false
    AND debt_id IN (SELECT id FROM public.debts WHERE status = 'settled');
    
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'purged_count', v_deleted_count);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_settled_debt_orphaned_payments() TO authenticated;
