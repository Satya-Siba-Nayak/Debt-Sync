-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 030: Consolidated Bulk / Avalanche Repayment Notifications & Single-Click Batch Verification
-- ═══════════════════════════════════════════════════════════════════════════
-- Fixes & Features:
-- 1. Ensures payments_update and payments_delete RLS policies are present (idempotent).
-- 2. Updates trg_activity_log_notify() to respect `suppress_notification: true` on bulk sub-items
--    and promote `total_bulk_amount` + `breakdown` on the primary bulk log entry so lenders/borrowers
--    receive ONLY ONE consolidated email & push notification per Avalanche/Bulk payment or verification.
-- 3. Upgrades verify_all_repayments(p_payment_ids UUID[], p_decision TEXT DEFAULT 'accepted')
--    to support both batch verification and batch dispute in one click, with consolidated notification details.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. ENSURE RLS POLICIES FOR PAYMENTS UPDATE & DELETE EXIST
DO $$
BEGIN
  DROP POLICY IF EXISTS "payments_update" ON public.payments;
  DROP POLICY IF EXISTS "payments_delete" ON public.payments;
END $$;

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

-- 2. UPDATE ACTIVITY LOG NOTIFICATION TRIGGER FOR CONSOLIDATED BULK EMAILS
CREATE OR REPLACE FUNCTION public.trg_activity_log_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_details JSONB := COALESCE(NEW.details, '{}'::jsonb);
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

  -- Skip notification dispatch for sub-items of a bulk payment or bulk verification
  IF COALESCE((v_details->>'suppress_notification')::boolean, false) = true THEN
    RETURN NEW;
  END IF;

  -- When this is the primary entry of a bulk operation, promote total_bulk_amount
  -- into 'amount' for the notification payload so the email/push shows the combined sum
  -- alongside the itemized breakdown.
  IF COALESCE((v_details->>'is_bulk')::boolean, false) = true AND (v_details ? 'total_bulk_amount') THEN
    v_details := v_details || jsonb_build_object(
      'individual_amount', v_details->'amount',
      'amount', v_details->'total_bulk_amount'
    );
  END IF;

  PERFORM public.dispatch_notification(jsonb_build_object(
    'event', NEW.action,
    'log_id', NEW.id,
    'debt_id', NEW.debt_id,
    'actor_id', NEW.user_id,
    'details', v_details
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activity_log_notify ON public.activity_log;
CREATE TRIGGER trg_activity_log_notify
  AFTER INSERT ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_log_notify();

-- 3. SINGLE & BATCH REPAYMENT VERIFICATION RPCs (WITH SUPPRESSED SUB-NOTIFICATIONS)
DROP FUNCTION IF EXISTS public.verify_repayment(UUID);
DROP FUNCTION IF EXISTS public.verify_repayment(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.verify_repayment(UUID, TEXT);
DROP FUNCTION IF EXISTS public.verify_repayment(UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.verify_repayment(UUID, TEXT, BOOLEAN, BOOLEAN, JSONB);

CREATE OR REPLACE FUNCTION public.verify_repayment(
  p_payment_id UUID,
  p_decision TEXT DEFAULT 'accepted',
  p_should_settle BOOLEAN DEFAULT NULL,
  p_suppress_notification BOOLEAN DEFAULT false,
  p_extra_details JSONB DEFAULT NULL
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
  v_log_details JSONB;
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
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = v_user_id AND (COALESCE(is_admin, false) = true OR COALESCE(is_super_admin, false) = true)
    ) THEN
      v_is_lender := true;
    ELSE
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

    v_log_details := jsonb_build_object(
      'payment_id', p_payment_id,
      'amount', v_payment.amount,
      'note', v_disputed_note,
      'disputed_by', v_user_id,
      'suppress_notification', COALESCE(p_suppress_notification, false)
    );
    IF p_extra_details IS NOT NULL THEN
      v_log_details := v_log_details || p_extra_details;
    END IF;

    INSERT INTO public.activity_log (debt_id, user_id, action, details)
    VALUES (
      v_debt.id,
      v_user_id,
      'payment_disputed',
      v_log_details
    );

    RETURN jsonb_build_object(
      'success', true,
      'disputed', true,
      'debt_settled', false,
      'amount', v_payment.amount,
      'debt_id', v_debt.id
    );
  END IF;

  -- ─── Accept / Verify Path ───
  UPDATE public.payments
  SET
    is_verified = true,
    verified_by = v_user_id,
    verified_at = NOW()
  WHERE id = p_payment_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_verified
  FROM public.payments
  WHERE debt_id = v_debt.id AND is_verified = true;

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

  v_log_details := jsonb_build_object(
    'payment_id', p_payment_id,
    'amount', v_payment.amount,
    'debt_settled', v_settled,
    'verified_by', v_user_id,
    'suppress_notification', COALESCE(p_suppress_notification, false)
  );
  IF p_extra_details IS NOT NULL THEN
    v_log_details := v_log_details || p_extra_details;
  END IF;

  INSERT INTO public.activity_log (debt_id, user_id, action, details)
  VALUES (
    v_debt.id,
    v_user_id,
    'payment_verified',
    v_log_details
  );

  RETURN jsonb_build_object(
    'success', true,
    'verified', true,
    'debt_settled', v_settled,
    'total_verified', v_total_verified,
    'amount', v_payment.amount,
    'debt_id', v_debt.id
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Overloads for 2 and 3 arguments
CREATE OR REPLACE FUNCTION public.verify_repayment(
  p_payment_id UUID,
  p_decision TEXT,
  p_should_settle BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RETURN public.verify_repayment(p_payment_id, p_decision, p_should_settle, false, NULL);
END;
$$;

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
  RETURN public.verify_repayment(p_payment_id, p_decision, NULL, false, NULL);
END;
$$;

-- 4. CONSOLIDATED BATCH VERIFY / DISPUTE RPC
DROP FUNCTION IF EXISTS public.verify_all_repayments(UUID[]);
DROP FUNCTION IF EXISTS public.verify_all_repayments(UUID[], TEXT);

CREATE OR REPLACE FUNCTION public.verify_all_repayments(
  p_payment_ids UUID[],
  p_decision TEXT DEFAULT 'accepted'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_pid UUID;
  v_processed_count INTEGER := 0;
  v_total_amount NUMERIC(15, 2) := 0;
  v_breakdown JSONB := '[]'::jsonb;
  v_last_res JSONB;
  v_idx INTEGER := 0;
  v_total_items INTEGER := 0;
  v_p_row RECORD;
  v_d_row RECORD;
  v_extra JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  v_total_items := COALESCE(array_length(p_payment_ids, 1), 0);
  IF v_total_items = 0 THEN
    RETURN jsonb_build_object('success', true, 'verified_count', 0, 'total_amount', 0);
  END IF;

  -- Pre-calculate total amount and breakdown across the batch for the consolidated notification
  FOR v_p_row IN
    SELECT p.id, p.amount, p.debt_id, p.note, d.principal, d.notes AS debt_notes, d.interest_rate
    FROM public.payments p
    LEFT JOIN public.debts d ON d.id = p.debt_id
    WHERE p.id = ANY(p_payment_ids)
  LOOP
    v_total_amount := v_total_amount + COALESCE(v_p_row.amount, 0);
    v_breakdown := v_breakdown || jsonb_build_array(
      jsonb_build_object(
        'payment_id', v_p_row.id,
        'debt_id', v_p_row.debt_id,
        'allocated', v_p_row.amount,
        'principal', v_p_row.principal,
        'rate', COALESCE(v_p_row.interest_rate, 0)
      )
    );
  END LOOP;

  FOREACH v_pid IN ARRAY p_payment_ids LOOP
    v_idx := v_idx + 1;

    IF v_total_items > 1 AND v_idx = 1 THEN
      -- First item carries the consolidated bulk summary for the single email/push notification
      v_extra := jsonb_build_object(
        'is_bulk', true,
        'total_bulk_amount', v_total_amount,
        'allocations_count', v_total_items,
        'breakdown', v_breakdown
      );
      v_last_res := public.verify_repayment(v_pid, p_decision, NULL, false, v_extra);
    ELSE
      -- Subsequent items in a multi-item batch suppress duplicate notifications
      v_last_res := public.verify_repayment(
        v_pid,
        p_decision,
        NULL,
        CASE WHEN v_total_items > 1 THEN true ELSE false END,
        NULL
      );
    END IF;

    IF (v_last_res->>'success')::boolean = true THEN
      v_processed_count := v_processed_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'verified_count', v_processed_count,
    'total_requested', v_total_items,
    'total_amount', v_total_amount
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_all_repayments(
  p_payment_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RETURN public.verify_all_repayments(p_payment_ids, 'accepted');
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_repayment(UUID, TEXT, BOOLEAN, BOOLEAN, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_repayment(UUID, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_repayment(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_all_repayments(UUID[], TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_all_repayments(UUID[]) TO authenticated, service_role;
