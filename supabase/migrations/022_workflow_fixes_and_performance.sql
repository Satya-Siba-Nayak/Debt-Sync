-- ============================================================================
-- Migration 022: Workflow Bug Fixes, Constraint Hardening & Performance Indexes
-- ============================================================================
-- Fixes:
-- 1. Foreign key constraints on activity_log, payments, and debts so profile
--    merges/deletions and debt cancellations never fail with 23503 errors.
-- 2. cancel_pending_debt RPC: Fixes FK violation (23503) where inserting into
--    activity_log with a just-deleted debt_id rolled back the entire "Take Back".
-- 3. verify_repayment RPC: Fixes premature settlement bug on interest-bearing
--    loans (previously checked principal only, ignoring accrued interest).
-- 4. resolve_ghost_profile_by_phone RPC: Fixes duplicate contact constraint
--    violation (23505) and migrates all child references cleanly.
-- 5. admin_delete_user & delete_user_account RPCs: Cleans up all FK references
--    (verified_by, paid_by, activity_log) and preserves counterparty history.
-- 6. Composite performance indexes for fast ledger, notification & admin queries.
-- ============================================================================

-- 0. Ensure System Tombstone Profile Exists
INSERT INTO public.profiles (
  id,
  email,
  full_name,
  is_shadow,
  is_isolated,
  isolation_reason
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'purged-account@system.debtsync.local',
  'Purged Account',
  true,
  true,
  'System tombstone profile for accounts purged by administrator'
)
ON CONFLICT (id) DO UPDATE SET
  full_name = 'Purged Account',
  is_shadow = true,
  is_isolated = true;

-- 1. Harden Foreign Key Constraints (ON DELETE SET NULL / CASCADE)
DO $$
BEGIN
  -- activity_log.user_id -> ON DELETE SET NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'activity_log_user_id_fkey' AND table_name = 'activity_log'
  ) THEN
    ALTER TABLE public.activity_log DROP CONSTRAINT activity_log_user_id_fkey;
  END IF;
  ALTER TABLE public.activity_log
    ADD CONSTRAINT activity_log_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL ON UPDATE CASCADE;

  -- payments.verified_by -> ON DELETE SET NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payments_verified_by_fkey' AND table_name = 'payments'
  ) THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_verified_by_fkey;
  END IF;
  ALTER TABLE public.payments
    ADD CONSTRAINT payments_verified_by_fkey
    FOREIGN KEY (verified_by) REFERENCES public.profiles(id) ON DELETE SET NULL ON UPDATE CASCADE;

  -- payments.paid_by -> ON DELETE SET NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payments_paid_by_fkey' AND table_name = 'payments'
  ) THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_paid_by_fkey;
  END IF;
  ALTER TABLE public.payments
    ADD CONSTRAINT payments_paid_by_fkey
    FOREIGN KEY (paid_by) REFERENCES public.profiles(id) ON DELETE SET NULL ON UPDATE CASCADE;

  -- debts.created_by -> ON DELETE SET NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'debts_created_by_fkey' AND table_name = 'debts'
  ) THEN
    ALTER TABLE public.debts DROP CONSTRAINT debts_created_by_fkey;
  END IF;
  ALTER TABLE public.debts
    ADD CONSTRAINT debts_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'FK constraint adjustment notice: %', SQLERRM;
END;
$$;

-- 2. Fix cancel_pending_debt RPC (Prevent 23503 FK error on activity_log.debt_id)
CREATE OR REPLACE FUNCTION public.cancel_pending_debt(p_debt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debt RECORD;
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_debt FROM public.debts WHERE id = p_debt_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;

  IF v_debt.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only pending (unaccepted) transactions can be taken back');
  END IF;

  IF v_debt.created_by IS NOT NULL AND v_debt.created_by != v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the creator of this pending transaction can take it back');
  END IF;

  IF v_debt.created_by IS NULL AND v_debt.lender_id != v_caller_id AND v_debt.borrower_id != v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to cancel this transaction');
  END IF;

  -- Delete the pending debt record
  DELETE FROM public.debts WHERE id = p_debt_id;

  -- Log to activity_log with debt_id = NULL because p_debt_id was just deleted from public.debts
  INSERT INTO public.activity_log (debt_id, user_id, action, details)
  VALUES (
    NULL,
    v_caller_id,
    'debt_cancelled_by_creator',
    jsonb_build_object(
      'debt_id', p_debt_id,
      'principal', v_debt.principal,
      'currency', v_debt.currency,
      'lender_id', v_debt.lender_id,
      'borrower_id', v_debt.borrower_id,
      'cancelled_at', NOW()
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_pending_debt(UUID) TO authenticated;

-- 3. Fix verify_repayment RPC (Supports p_decision 'accepted'/'declined' & interest-aware settlement)
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
SET search_path = public
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

  IF v_debt.lender_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the lender can verify or dispute repayments');
  END IF;

  -- Handle Decline / Dispute decision
  IF lower(COALESCE(p_decision, 'accepted')) IN ('declined', 'disputed') THEN
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

  -- Handle Accept / Verify decision
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

  -- Determine whether the debt is fully settled
  IF p_should_settle IS NOT NULL THEN
    v_settled := p_should_settle;
  ELSE
    -- Compute interest-aware total obligation in SQL as fallback
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

  IF v_settled THEN
    UPDATE public.debts
    SET status = 'settled', settled_at = NOW(), updated_at = NOW()
    WHERE id = v_debt.id;

    -- Clean up any leftover unverified duplicate payment requests on this settled debt
    DELETE FROM public.payments
    WHERE debt_id = v_debt.id AND is_verified = false;
  END IF;

  INSERT INTO public.activity_log (debt_id, user_id, action, details)
  VALUES (
    v_debt.id,
    v_user_id,
    'payment_verified',
    jsonb_build_object(
      'payment_id', p_payment_id,
      'amount', v_payment.amount,
      'debt_settled', v_settled
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'debt_settled', v_settled,
    'total_verified', v_total_verified
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_repayment(UUID, TEXT, BOOLEAN) TO authenticated;

-- 4. Fix resolve_ghost_profile_by_phone RPC (Deduplicate contacts to prevent 23505)
CREATE OR REPLACE FUNCTION public.resolve_ghost_profile_by_phone(
  p_phone TEXT,
  p_user_id UUID,
  p_user_email TEXT,
  p_keep_ghost_email_as_secondary BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_digits TEXT;
  v_ghost RECORD;
  v_merged_count INT := 0;
  v_ghost_emails TEXT[] := ARRAY[]::TEXT[];
  v_existing_secondaries TEXT[];
BEGIN
  IF p_phone IS NULL OR length(trim(p_phone)) < 7 THEN
    RETURN jsonb_build_object('success', false, 'merged_count', 0);
  END IF;

  v_clean_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  IF length(v_clean_digits) > 10 THEN
    v_clean_digits := right(v_clean_digits, 10);
  END IF;

  IF length(v_clean_digits) < 7 THEN
    RETURN jsonb_build_object('success', false, 'merged_count', 0);
  END IF;

  FOR v_ghost IN
    SELECT * FROM public.profiles
    WHERE is_shadow = true
      AND id != p_user_id
      AND id != '00000000-0000-0000-0000-000000000001'
      AND phone IS NOT NULL
      AND (
        regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g')
        OR (
          length(v_clean_digits) = 10
          AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = v_clean_digits
        )
      )
  LOOP
    -- Reassign debts
    UPDATE public.debts SET lender_id = p_user_id WHERE lender_id = v_ghost.id;
    UPDATE public.debts SET borrower_id = p_user_id WHERE borrower_id = v_ghost.id;
    UPDATE public.debts SET created_by = p_user_id WHERE created_by = v_ghost.id;

    -- Reassign payments & activity_log
    UPDATE public.payments SET paid_by = p_user_id WHERE paid_by = v_ghost.id;
    UPDATE public.payments SET verified_by = p_user_id WHERE verified_by = v_ghost.id;
    UPDATE public.activity_log SET user_id = p_user_id WHERE user_id = v_ghost.id;

    -- Safely deduplicate contacts before reassigning contact_id / owner_id
    -- Delete self-contacts that would result if owner_id = p_user_id and contact_id = v_ghost.id
    DELETE FROM public.contacts
    WHERE (owner_id = p_user_id AND contact_id = v_ghost.id)
       OR (owner_id = v_ghost.id AND contact_id = p_user_id);

    -- Delete ghost contact rows where the owner ALREADY has p_user_id as a contact
    DELETE FROM public.contacts c_ghost
    WHERE c_ghost.contact_id = v_ghost.id
      AND EXISTS (
        SELECT 1 FROM public.contacts c_real
        WHERE c_real.owner_id = c_ghost.owner_id
          AND c_real.contact_id = p_user_id
      );

    -- Delete ghost owner rows where p_user_id ALREADY owns that contact_id
    DELETE FROM public.contacts c_ghost
    WHERE c_ghost.owner_id = v_ghost.id
      AND EXISTS (
        SELECT 1 FROM public.contacts c_real
        WHERE c_real.owner_id = p_user_id
          AND c_real.contact_id = c_ghost.contact_id
      );

    UPDATE public.contacts SET contact_id = p_user_id WHERE contact_id = v_ghost.id;
    UPDATE public.contacts SET owner_id = p_user_id WHERE owner_id = v_ghost.id;

    -- Clean up any contact_requests referencing the ghost profile
    DELETE FROM public.contact_requests
    WHERE sender_id = v_ghost.id OR receiver_id = v_ghost.id;

    -- Collect ghost email if it was a real email and differs from p_user_email
    IF v_ghost.email IS NOT NULL
       AND v_ghost.email NOT LIKE '%@phone.debtsync.local'
       AND lower(trim(v_ghost.email)) != lower(trim(COALESCE(p_user_email, '')))
    THEN
      v_ghost_emails := array_append(v_ghost_emails, lower(trim(v_ghost.email)));
    END IF;

    -- Delete the merged ghost profile
    DELETE FROM public.profiles WHERE id = v_ghost.id;
    v_merged_count := v_merged_count + 1;
  END LOOP;

  -- Append ghost emails to secondary_emails if requested
  IF v_merged_count > 0 AND p_keep_ghost_email_as_secondary AND array_length(v_ghost_emails, 1) > 0 THEN
    SELECT COALESCE(secondary_emails, ARRAY[]::TEXT[]) INTO v_existing_secondaries
    FROM public.profiles WHERE id = p_user_id;

    SELECT ARRAY(
      SELECT DISTINCT e FROM unnest(v_existing_secondaries || v_ghost_emails) AS e
      WHERE e IS NOT NULL AND length(trim(e)) > 0
    ) INTO v_existing_secondaries;

    UPDATE public.profiles
    SET secondary_emails = v_existing_secondaries
    WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'merged_count', v_merged_count,
    'merged_emails', v_ghost_emails
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_ghost_profile_by_phone(TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

-- 5. Harden admin_delete_user RPC (Clean all FK references and mark counterparty debts as purged)
DROP FUNCTION IF EXISTS public.admin_delete_user(UUID);
DROP FUNCTION IF EXISTS public.admin_delete_user(UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.admin_delete_user(
  target_user_id UUID,
  p_force_cascade BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_target_profile RECORD;
  v_active_debts_count INT := 0;
  v_total_debts_count INT := 0;
  v_tombstone_id UUID := '00000000-0000-0000-0000-000000000001';
  v_preserved_debts_count INT := 0;
  v_purge_notice TEXT;
BEGIN
  SELECT (COALESCE(is_admin, false) OR COALESCE(is_super_admin, false)) INTO v_is_admin
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT COALESCE(v_is_admin, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin privileges required.');
  END IF;

  IF target_user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Administrators cannot purge their own account via this tool.');
  END IF;

  IF target_user_id = v_tombstone_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'System Protection: The Purged Account tombstone profile cannot be deleted.');
  END IF;

  SELECT * INTO v_target_profile
  FROM public.profiles
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target profile not found.');
  END IF;

  IF COALESCE(v_target_profile.is_admin, false) OR COALESCE(v_target_profile.is_super_admin, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot delete an administrator account. Revoke admin privileges first.');
  END IF;

  -- Ensure system tombstone exists
  INSERT INTO public.profiles (
    id, email, full_name, is_shadow, is_isolated, is_purged, isolation_reason
  )
  VALUES (
    v_tombstone_id,
    'purged-account@debtsync.local',
    'Purged Account',
    true,
    true,
    true,
    'System tombstone profile for accounts purged by administrator'
  )
  ON CONFLICT (id) DO UPDATE SET
    is_purged = true,
    full_name = 'Purged Account',
    is_shadow = true;

  -- Count live debts
  SELECT COUNT(*) INTO v_active_debts_count
  FROM public.debts
  WHERE (lender_id = target_user_id OR borrower_id = target_user_id)
    AND status IN ('active', 'pending');

  SELECT COUNT(*) INTO v_total_debts_count
  FROM public.debts
  WHERE (lender_id = target_user_id OR borrower_id = target_user_id);

  IF v_active_debts_count > 0 AND NOT p_force_cascade THEN
    RETURN jsonb_build_object(
      'success', false,
      'has_active_debts', true,
      'active_count', v_active_debts_count,
      'total_count', v_total_debts_count,
      'error', 'Cannot purge account: user has ' || v_active_debts_count || ' active transaction(s). Force cascade confirmation required.'
    );
  END IF;

  -- Delete purely self-referential or internal debts
  DELETE FROM public.debts
  WHERE (lender_id = target_user_id AND borrower_id IN (target_user_id, v_tombstone_id))
     OR (borrower_id = target_user_id AND lender_id IN (target_user_id, v_tombstone_id));

  v_purge_notice := '[TRANSACTION PURGED BY ADMIN: Counterparty account (' || COALESCE(v_target_profile.full_name, v_target_profile.email, 'User') || ') was purged by an administrator. For inquiries or disputes, contact support@satya-nayak.dev]';

  -- Preserve counterparty debts by marking status as 'purged', prepending notice, and reassigning target side to tombstone
  WITH updated_lender AS (
    UPDATE public.debts
    SET
      status = 'purged',
      lender_id = v_tombstone_id,
      created_by = CASE WHEN created_by = target_user_id THEN v_tombstone_id ELSE created_by END,
      notes = CASE
        WHEN COALESCE(notes, '') LIKE '%[TRANSACTION PURGED BY ADMIN%' THEN notes
        ELSE v_purge_notice || COALESCE(E'\n' || notes, '')
      END,
      updated_at = NOW()
    WHERE lender_id = target_user_id
    RETURNING id
  ),
  updated_borrower AS (
    UPDATE public.debts
    SET
      status = 'purged',
      borrower_id = v_tombstone_id,
      created_by = CASE WHEN created_by = target_user_id THEN v_tombstone_id ELSE created_by END,
      notes = CASE
        WHEN COALESCE(notes, '') LIKE '%[TRANSACTION PURGED BY ADMIN%' THEN notes
        ELSE v_purge_notice || COALESCE(E'\n' || notes, '')
      END,
      updated_at = NOW()
    WHERE borrower_id = target_user_id
    RETURNING id
  )
  SELECT (SELECT count(*) FROM updated_lender) + (SELECT count(*) FROM updated_borrower)
  INTO v_preserved_debts_count;

  -- Clear remaining FK references to target_user_id across all tables
  UPDATE public.debts SET created_by = v_tombstone_id WHERE created_by = target_user_id;
  UPDATE public.payments SET paid_by = v_tombstone_id WHERE paid_by = target_user_id;
  UPDATE public.payments SET verified_by = NULL WHERE verified_by = target_user_id;
  UPDATE public.activity_log SET user_id = NULL WHERE user_id = target_user_id;

  -- Delete dependent user rows
  DELETE FROM public.contact_requests
  WHERE sender_id = target_user_id OR receiver_id = target_user_id;

  DELETE FROM public.contacts
  WHERE owner_id = target_user_id OR contact_id = target_user_id;

  DELETE FROM public.user_settings
  WHERE user_id = target_user_id;

  DELETE FROM public.profiles
  WHERE id = target_user_id;

  BEGIN
    DELETE FROM auth.users WHERE id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Log admin audit event permanently
  INSERT INTO public.activity_log (user_id, action, details)
  VALUES (
    auth.uid(),
    'ADMIN_USER_PURGED',
    jsonb_build_object(
      'target_user_id', target_user_id,
      'target_email', v_target_profile.email,
      'target_name', v_target_profile.full_name,
      'target_phone', v_target_profile.phone,
      'preserved_counterparty_debts', v_preserved_debts_count,
      'active_debts_count', v_active_debts_count,
      'admin_id', auth.uid(),
      'support_contact', 'support@satya-nayak.dev',
      'purged_at', NOW()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'User account successfully purged. Counterparty transactions preserved and marked as (Transaction purged by admin).',
    'purged_debts_count', v_preserved_debts_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID, BOOLEAN) TO authenticated, service_role;

-- 6. Harden delete_user_account RPC (Self-deletion preserves settled counterparty ledgers)
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_active_debt_count INT := 0;
  v_user_profile RECORD;
  v_tombstone_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_user_profile FROM public.profiles WHERE id = v_user_id;

  -- Check for any unresolved debts (active, pending, or disputed)
  SELECT COUNT(*) INTO v_active_debt_count
  FROM public.debts
  WHERE (lender_id = v_user_id OR borrower_id = v_user_id)
    AND status IN ('active', 'pending', 'disputed');

  IF v_active_debt_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Account deletion blocked: You still have ' || v_active_debt_count || ' active or pending debt(s). All obligations must be settled first.'
    );
  END IF;

  -- Ensure system tombstone exists so settled counterparty history is preserved
  INSERT INTO public.profiles (
    id, email, full_name, is_shadow, is_isolated, isolation_reason
  )
  VALUES (
    v_tombstone_id,
    'purged-account@system.debtsync.local',
    'Purged Account',
    true,
    true,
    'System tombstone profile for deleted/purged accounts'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Delete declined debts or self-only debts
  DELETE FROM public.debts
  WHERE (lender_id = v_user_id OR borrower_id = v_user_id)
    AND status = 'declined';

  DELETE FROM public.debts
  WHERE (lender_id = v_user_id AND borrower_id IN (v_user_id, v_tombstone_id))
     OR (borrower_id = v_user_id AND lender_id IN (v_user_id, v_tombstone_id));

  -- Reassign settled counterparty debts to tombstone so counterparty keeps their settled archive
  UPDATE public.debts
  SET lender_id = v_tombstone_id, created_by = NULL
  WHERE lender_id = v_user_id;

  UPDATE public.debts
  SET borrower_id = v_tombstone_id, created_by = NULL
  WHERE borrower_id = v_user_id;

  UPDATE public.debts SET created_by = NULL WHERE created_by = v_user_id;
  UPDATE public.payments SET paid_by = v_tombstone_id WHERE paid_by = v_user_id;
  UPDATE public.payments SET verified_by = NULL WHERE verified_by = v_user_id;
  UPDATE public.activity_log SET user_id = NULL WHERE user_id = v_user_id;

  DELETE FROM public.contact_requests WHERE sender_id = v_user_id OR receiver_id = v_user_id;
  DELETE FROM public.contacts WHERE owner_id = v_user_id OR contact_id = v_user_id;
  DELETE FROM public.user_settings WHERE user_id = v_user_id;
  DELETE FROM public.profiles WHERE id = v_user_id;
  DELETE FROM auth.users WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

-- 7. Performance Indexes for Fast Dashboard, Notifications & Admin Queries
CREATE INDEX IF NOT EXISTS idx_debts_lender_status ON public.debts(lender_id, status);
CREATE INDEX IF NOT EXISTS idx_debts_borrower_status ON public.debts(borrower_id, status);
CREATE INDEX IF NOT EXISTS idx_debts_created_at_desc ON public.debts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_debt_verified ON public.payments(debt_id, is_verified);
CREATE INDEX IF NOT EXISTS idx_activity_log_debt_created ON public.activity_log(debt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_desc ON public.activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_is_shadow ON public.profiles(is_shadow) WHERE is_shadow = true;

-- 8. Enhanced get_debt_for_acceptance (Includes due_date, settled_at, and split details)
DROP FUNCTION IF EXISTS public.get_debt_for_acceptance(UUID);

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
  due_date TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  split_group_id UUID,
  split_details JSONB,
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
SET search_path = public
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
    d.due_date,
    d.settled_at,
    d.split_group_id,
    d.split_details,
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

GRANT EXECUTE ON FUNCTION public.get_debt_for_acceptance(UUID) TO anon, authenticated, service_role;
