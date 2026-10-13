-- ═══════════════════════════════════════════════════════════════
-- Migration 021: Transaction Purged by Admin Status & Support Alignment
-- ═══════════════════════════════════════════════════════════════

-- 1. Extend debts.status constraint to include 'purged'
ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_status_check;
ALTER TABLE public.debts ADD CONSTRAINT debts_status_check 
  CHECK (status IN ('pending', 'active', 'settled', 'disputed', 'declined', 'purged'));

-- 2. Add is_purged and purged_at to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_purged BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;

-- 3. Create or ensure system tombstone profile exists for counterparty preservation
INSERT INTO public.profiles (id, email, full_name, is_shadow, is_isolated, is_purged)
VALUES (
  '00000000-0000-0000-0000-000000000001'::UUID,
  'purged-account@debtsync.local',
  'Purged Account',
  true,
  true,
  true
)
ON CONFLICT (id) DO UPDATE 
SET is_purged = true, 
    full_name = 'Purged Account',
    is_shadow = true;

-- 4. Enhanced admin_delete_user RPC: Preserve counterparty ledgers marked as '(Transaction purged by admin)'
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
  v_target_email TEXT;
  v_target_phone TEXT;
  v_target_name TEXT;
  v_active_debts_count INT := 0;
  v_total_debts_count INT := 0;
  v_system_purged_id UUID := '00000000-0000-0000-0000-000000000001'::UUID;
BEGIN
  -- Verify caller is admin or super admin
  SELECT (is_admin OR is_super_admin) INTO v_is_admin
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT coalesce(v_is_admin, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin privileges required.');
  END IF;

  -- Prevent self-deletion via admin tool
  IF target_user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Administrators cannot purge their own account via this tool.');
  END IF;

  -- Prevent deletion of system tombstone profile
  IF target_user_id = v_system_purged_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Protected System Account: The tombstone profile cannot be purged.');
  END IF;

  SELECT email, phone, full_name INTO v_target_email, v_target_phone, v_target_name 
  FROM public.profiles WHERE id = target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target account profile not found.');
  END IF;

  -- Ensure system tombstone profile exists
  INSERT INTO public.profiles (id, email, full_name, is_shadow, is_isolated, is_purged)
  VALUES (v_system_purged_id, 'purged-account@debtsync.local', 'Purged Account', true, true, true)
  ON CONFLICT (id) DO UPDATE SET is_purged = true;

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

  -- 1. For debts where a counterparty exists (the other user):
  -- Update debts to status 'purged', add admin notice with support contact info, and reassign target_user_id to system profile
  UPDATE public.debts
  SET status = 'purged',
      notes = '[TRANSACTION PURGED BY ADMIN: Counterparty account (' || coalesce(v_target_name, v_target_email) || ') was purged by an administrator. For inquiries or disputes, contact support@satya-nayak.dev]' || coalesce(E'\n' || notes, ''),
      lender_id = CASE WHEN lender_id = target_user_id THEN v_system_purged_id ELSE lender_id END,
      borrower_id = CASE WHEN borrower_id = target_user_id THEN v_system_purged_id ELSE borrower_id END,
      created_by = CASE WHEN created_by = target_user_id THEN v_system_purged_id ELSE created_by END
  WHERE (lender_id = target_user_id AND borrower_id != target_user_id)
     OR (borrower_id = target_user_id AND lender_id != target_user_id);

  -- 2. Purely self-referential or internal debts are deleted
  DELETE FROM public.debts
  WHERE lender_id = target_user_id AND borrower_id = target_user_id;

  -- 3. Payments made by target user on remaining debts: reassign paid_by or annotate
  UPDATE public.payments
  SET paid_by = v_system_purged_id,
      note = '[Payer Account Purged by Admin] ' || coalesce(note, '')
  WHERE paid_by = target_user_id;

  -- 4. Cleanup settings, contacts, requests
  DELETE FROM public.user_settings WHERE user_id = target_user_id;
  DELETE FROM public.contacts WHERE owner_id = target_user_id OR contact_id = target_user_id;
  DELETE FROM public.contact_requests WHERE sender_id = target_user_id OR receiver_id = target_user_id;

  -- 5. Delete profile record
  DELETE FROM public.profiles WHERE id = target_user_id;

  -- 6. Delete auth user record if exists
  BEGIN
    DELETE FROM auth.users WHERE id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 7. Audit log permanent entry
  INSERT INTO public.activity_log (user_id, action, details)
  VALUES (
    auth.uid(),
    'ADMIN_USER_PURGED',
    jsonb_build_object(
      'target_user_id', target_user_id,
      'target_email', v_target_email,
      'target_name', v_target_name,
      'target_phone', v_target_phone,
      'debts_marked_purged', v_total_debts_count,
      'active_debts_count', v_active_debts_count,
      'admin_id', auth.uid(),
      'support_contact', 'support@satya-nayak.dev',
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true, 
    'message', 'User account successfully purged. Counterparty transactions preserved and marked as (Transaction purged by admin).',
    'purged_debts_count', v_total_debts_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID, BOOLEAN) TO authenticated, service_role;
