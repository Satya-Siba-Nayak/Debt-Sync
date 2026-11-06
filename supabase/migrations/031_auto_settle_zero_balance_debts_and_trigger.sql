-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 031: Auto-Settle Zero-Balance Debts, Payment Verification Trigger Hardening & Real-Time Sync
-- ═══════════════════════════════════════════════════════════════════════════
-- Addresses:
-- 1. Debts remaining 'active' even when balance reaches ₹0.00 / obligation cleared.
-- 2. False 'Unauthorized: Only the lender can verify repayments' trigger errors
--    when the lender profile is a ghost profile, matches via secondary email, or matches via phone.
-- 3. Automatic debt settlement via DB trigger on public.payments whenever verified payments cover obligation.
-- 4. Batch auto-healing for any historical active debts whose verified payments have cleared the balance.
-- ═══════════════════════════════════════════════════════════════════════════

-- Ensure updated_at exists on debts
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 1. HARDEN PAYMENT VERIFICATION INTEGRITY TRIGGER (ALLOW GHOST LENDERS & PHONE/EMAIL MATCH)
CREATE OR REPLACE FUNCTION public.enforce_payment_verification_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_debt RECORD;
  v_is_admin BOOLEAN := false;
  v_is_authorized_lender BOOLEAN := false;
BEGIN
  -- Service role or background jobs without auth context are trusted
  IF v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_debt FROM public.debts WHERE id = NEW.debt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated debt record not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Admin check
  SELECT (COALESCE(is_admin, false) OR COALESCE(is_super_admin, false))
  INTO v_is_admin
  FROM public.profiles
  WHERE id = v_caller_id;

  IF COALESCE(v_is_admin, false) THEN
    RETURN NEW;
  END IF;

  -- Lender authorization check (supports direct ID match, email match, secondary email match, and phone match)
  IF v_caller_id = v_debt.lender_id THEN
    v_is_authorized_lender := true;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.profiles lp
      JOIN public.profiles up ON up.id = v_caller_id
      WHERE lp.id = v_debt.lender_id
        AND (
          lp.email = up.email
          OR lp.email = ANY(COALESCE(up.secondary_emails, '{}'::text[]))
          OR (lp.phone IS NOT NULL AND lp.phone = up.phone)
        )
    ) THEN
      v_is_authorized_lender := true;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Block logging payments on pending, declined, or purged debts
    IF v_debt.status IN ('pending', 'declined', 'purged') THEN
      RAISE EXCEPTION 'Cannot record repayments on a % transaction. The agreement must be active first.', v_debt.status
        USING ERRCODE = '42501';
    END IF;

    -- Only the authorized lender can insert an already-verified payment; borrower submissions start unverified
    IF NOT v_is_authorized_lender THEN
      NEW.is_verified := false;
      NEW.verified_by := NULL;
      NEW.verified_at := NULL;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only the authorized lender (or admin) can verify a payment or alter verification fields
    IF (NEW.is_verified IS DISTINCT FROM OLD.is_verified OR NEW.verified_by IS DISTINCT FROM OLD.verified_by)
       AND NOT v_is_authorized_lender
    THEN
      RAISE EXCEPTION 'Unauthorized: Only the lender can verify repayments.'
        USING ERRCODE = '42501';
    END IF;

    -- Prevent altering payment amount after verification
    IF OLD.is_verified = true AND NEW.amount IS DISTINCT FROM OLD.amount THEN
      RAISE EXCEPTION 'Immutable payment: Verified repayment amounts cannot be modified.'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payment_verification_integrity ON public.payments;
CREATE TRIGGER trg_enforce_payment_verification_integrity
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_payment_verification_integrity();

-- 2. AUTOMATIC DEBT SETTLEMENT TRIGGER ON PAYMENTS (AFTER INSERT OR UPDATE OF is_verified, amount)
CREATE OR REPLACE FUNCTION public.auto_settle_debt_on_payment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_debt RECORD;
  v_total_verified NUMERIC(15, 2) := 0;
  v_days_elapsed NUMERIC := 0;
  v_years NUMERIC := 0;
  v_periods_per_year NUMERIC := 12;
  v_total_obligation NUMERIC(15, 2) := 0;
  v_target_debt_id UUID;
BEGIN
  v_target_debt_id := COALESCE(NEW.debt_id, OLD.debt_id);
  IF v_target_debt_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_debt FROM public.debts WHERE id = v_target_debt_id;
  IF NOT FOUND OR v_debt.status != 'active' THEN
    RETURN NEW;
  END IF;

  -- Calculate total verified repayments for this debt
  SELECT COALESCE(SUM(amount), 0) INTO v_total_verified
  FROM public.payments
  WHERE debt_id = v_target_debt_id AND is_verified = true;

  -- Calculate obligation
  IF v_debt.interest_type = 'none' OR COALESCE(v_debt.interest_rate, 0) <= 0 THEN
    v_total_obligation := v_debt.principal;
  ELSE
    v_days_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(v_debt.accepted_at, v_debt.created_at))) / 86400.0);
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

  -- Settle if verified repayments cover the debt (allowing a 0.05 rounding threshold for day-count interest fractions)
  IF (v_debt.interest_type = 'none' AND v_total_verified >= (v_debt.principal - 0.01))
     OR (v_total_verified >= (v_total_obligation - 0.05))
  THEN
    UPDATE public.debts
    SET status = 'settled',
        settled_at = COALESCE(settled_at, NOW()),
        updated_at = NOW()
    WHERE id = v_debt.id AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_auto_settle_debt ON public.payments;
CREATE TRIGGER trg_payments_auto_settle_debt
AFTER INSERT OR UPDATE OF is_verified, amount ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.auto_settle_debt_on_payment_change();

-- 3. HARDEN VERIFY_REPAYMENT RPC TO ENSURE FULL SETTLEMENT ON ZERO BALANCE
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

  -- Check if caller is authorized
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
      v_days_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(v_debt.accepted_at, v_debt.created_at))) / 86400.0);
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

    v_settled := (v_debt.interest_type = 'none' AND v_total_verified >= (v_debt.principal - 0.01))
                 OR (v_total_verified >= (v_total_obligation - 0.05));
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
END;
$$;

-- 4. RPC TO BULK AUTO-SETTLE ALL ZERO-BALANCE DEBTS
CREATE OR REPLACE FUNCTION public.auto_settle_cleared_debts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_debt RECORD;
  v_total_verified NUMERIC(15, 2);
  v_days_elapsed NUMERIC;
  v_years NUMERIC;
  v_periods_per_year NUMERIC;
  v_total_obligation NUMERIC(15, 2);
  v_settled_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  FOR v_debt IN
    SELECT * FROM public.debts WHERE status = 'active'
  LOOP
    SELECT COALESCE(SUM(amount), 0) INTO v_total_verified
    FROM public.payments
    WHERE debt_id = v_debt.id AND is_verified = true;

    IF v_debt.interest_type = 'none' OR COALESCE(v_debt.interest_rate, 0) <= 0 THEN
      v_total_obligation := v_debt.principal;
    ELSE
      v_days_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(v_debt.accepted_at, v_debt.created_at))) / 86400.0);
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

    IF (v_debt.interest_type = 'none' AND v_total_verified >= (v_debt.principal - 0.01))
       OR (v_total_verified >= (v_total_obligation - 0.05))
    THEN
      UPDATE public.debts
      SET status = 'settled', settled_at = COALESCE(settled_at, NOW()), updated_at = NOW()
      WHERE id = v_debt.id;
      v_settled_ids := array_append(v_settled_ids, v_debt.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'settled_count', coalesce(array_length(v_settled_ids, 1), 0),
    'settled_debt_ids', v_settled_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_settle_cleared_debts() TO authenticated, service_role;

-- 5. RUN IMMEDIATE AUTO-HEALING FOR EXISTING HISTORICAL ZERO-BALANCE DEBTS
SELECT public.auto_settle_cleared_debts();
