-- ═══════════════════════════════════════════════════════════════
-- 020: Admin Purge Cascade, Cancel Pending Debt & Ghost Phone Resolution
-- ═══════════════════════════════════════════════════════════════

-- 1. Enhanced admin_delete_user RPC with cascade/safe-purge of user debts & payments
CREATE OR REPLACE FUNCTION public.admin_delete_user(
  target_user_id UUID,
  p_force_cascade BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_is_admin BOOLEAN;
  v_caller_is_super BOOLEAN;
  v_target_email TEXT;
  v_target_phone TEXT;
  v_active_debts_count INT;
  v_total_debts_count INT;
BEGIN
  SELECT COALESCE(is_admin, false), COALESCE(is_super_admin, false)
  INTO v_caller_is_admin, v_caller_is_super
  FROM public.profiles WHERE id = auth.uid();

  IF NOT v_caller_is_admin AND NOT v_caller_is_super THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Administrator privileges required.');
  END IF;

  -- Prevent self-deletion via admin tool
  IF target_user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Administrators cannot purge their own account via this tool.');
  END IF;

  SELECT email, phone INTO v_target_email, v_target_phone 
  FROM public.profiles WHERE id = target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target account profile not found.');
  END IF;

  -- Check count of live/active/pending debts
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

  -- 1. Cascade cleanup payments linked to debts of this user
  DELETE FROM public.payments 
  WHERE debt_id IN (
    SELECT id FROM public.debts 
    WHERE lender_id = target_user_id OR borrower_id = target_user_id
  ) OR paid_by = target_user_id OR verified_by = target_user_id;

  -- 2. Cascade cleanup debts where user is lender or borrower
  DELETE FROM public.debts 
  WHERE lender_id = target_user_id OR borrower_id = target_user_id OR created_by = target_user_id;

  -- 3. Cleanup user settings and contacts
  DELETE FROM public.user_settings WHERE user_id = target_user_id;
  DELETE FROM public.contacts WHERE owner_id = target_user_id OR contact_id = target_user_id;
  DELETE FROM public.contact_requests WHERE sender_id = target_user_id OR receiver_id = target_user_id;

  -- 4. Delete profile
  DELETE FROM public.profiles WHERE id = target_user_id;

  -- 5. Delete auth user record if exists
  BEGIN
    DELETE FROM auth.users WHERE id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    -- Ignore if caller lacks auth.users deletion privileges
    NULL;
  END;

  -- 6. Log admin audit event permanently
  INSERT INTO public.activity_log (user_id, action, details)
  VALUES (
    auth.uid(),
    'ADMIN_USER_PURGED',
    jsonb_build_object(
      'target_user_id', target_user_id,
      'target_email', v_target_email,
      'target_phone', v_target_phone,
      'cascade_debts_purged', v_total_debts_count,
      'active_debts_purged', v_active_debts_count,
      'admin_id', auth.uid(),
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true, 
    'message', 'User account and associated records successfully purged.',
    'purged_debts_count', v_total_debts_count
  );
END;
$$;


-- 2. User RPC: Cancel / Take Back a Pending Debt (Creator only, prior to acceptance)
CREATE OR REPLACE FUNCTION public.cancel_pending_debt(p_debt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_debt RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT * INTO v_debt FROM public.debts WHERE id = p_debt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Debt agreement not found.');
  END IF;

  -- Verify caller is creator or a party to this pending debt
  IF v_debt.created_by != v_user_id AND v_debt.lender_id != v_user_id AND v_debt.borrower_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the creator can take back this pending agreement.');
  END IF;

  IF v_debt.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only pending agreements that have not yet been accepted can be taken back.');
  END IF;

  -- Delete any unverified payment records attached to this debt
  DELETE FROM public.payments WHERE debt_id = p_debt_id;

  -- Delete the pending debt
  DELETE FROM public.debts WHERE id = p_debt_id;

  -- Log action in activity log
  INSERT INTO public.activity_log (user_id, debt_id, action, details)
  VALUES (
    v_user_id,
    p_debt_id,
    'debt_cancelled_by_creator',
    jsonb_build_object(
      'debt_id', p_debt_id,
      'principal', v_debt.principal,
      'currency', v_debt.currency,
      'counterparty_id', CASE WHEN v_debt.lender_id = v_user_id THEN v_debt.borrower_id ELSE v_debt.lender_id END,
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object('success', true, 'message', 'Pending agreement taken back successfully.');
END;
$$;


-- 3. Policy: Allow users to delete their own pending debts (RLS fallback)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'debts' AND policyname = 'debts_delete_pending'
  ) THEN
    CREATE POLICY "debts_delete_pending" ON public.debts
      FOR DELETE USING (
        status = 'pending' 
        AND (created_by = auth.uid() OR lender_id = auth.uid() OR borrower_id = auth.uid())
      );
  END IF;
END $$;


-- 4. RPC: Resolve ghost profile by phone number upon user registration / claiming
CREATE OR REPLACE FUNCTION public.resolve_ghost_profile_by_phone(
  p_phone TEXT,
  p_user_id UUID,
  p_user_email TEXT,
  p_keep_ghost_email_as_secondary BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ghost RECORD;
  v_clean_phone TEXT;
  v_merged_count INT := 0;
BEGIN
  IF p_user_id IS NULL OR p_user_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User ID and Email required.');
  END IF;

  v_clean_phone := regexp_replace(p_phone, '[^\d]', '', 'g');
  IF length(v_clean_phone) < 7 THEN
    RETURN jsonb_build_object('success', true, 'merged', 0);
  END IF;

  FOR v_ghost IN
    SELECT * FROM public.profiles
    WHERE is_shadow = true
      AND regexp_replace(COALESCE(phone, ''), '[^\d]', '', 'g') LIKE ('%' || right(v_clean_phone, 10))
      AND id != p_user_id
  LOOP
    -- Transfer debts
    UPDATE public.debts SET lender_id = p_user_id WHERE lender_id = v_ghost.id;
    UPDATE public.debts SET borrower_id = p_user_id WHERE borrower_id = v_ghost.id;
    UPDATE public.debts SET created_by = p_user_id WHERE created_by = v_ghost.id;

    -- Transfer contacts
    UPDATE public.contacts SET owner_id = p_user_id WHERE owner_id = v_ghost.id;
    UPDATE public.contacts SET contact_id = p_user_id WHERE contact_id = v_ghost.id;

    -- If ghost had an email and p_keep_ghost_email_as_secondary is true, add to secondary_emails
    IF v_ghost.email IS NOT NULL 
       AND v_ghost.email NOT LIKE '%@phone.debtsync.local' 
       AND lower(v_ghost.email) != lower(p_user_email)
       AND p_keep_ghost_email_as_secondary THEN
      UPDATE public.profiles
      SET secondary_emails = array_append(
        COALESCE(secondary_emails, ARRAY[]::TEXT[]),
        lower(v_ghost.email)
      )
      WHERE id = p_user_id
        AND NOT (lower(v_ghost.email) = ANY(COALESCE(secondary_emails, ARRAY[]::TEXT[])));
    END IF;

    -- Remove ghost profile
    DELETE FROM public.profiles WHERE id = v_ghost.id;
    v_merged_count := v_merged_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'merged_ghost_count', v_merged_count
  );
END;
$$;
