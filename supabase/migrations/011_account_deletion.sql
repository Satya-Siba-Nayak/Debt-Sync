-- ═══════════════════════════════════════════════════════════════
-- Migration 011: Restricted Account Deletion RPC
-- Safe, Idempotent, and Strictly Enforced
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_active_count INT;
  v_pending_count INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- 1. Check for active or disputed debts
  SELECT count(*) INTO v_active_count
  FROM public.debts
  WHERE (lender_id = v_user_id OR borrower_id = v_user_id)
    AND status IN ('active', 'disputed');

  IF v_active_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Account deletion blocked: You have active debt obligations that must be settled before deleting your account.'
    );
  END IF;

  -- 2. Check for unresolved pending debt agreements
  SELECT count(*) INTO v_pending_count
  FROM public.debts
  WHERE (lender_id = v_user_id OR borrower_id = v_user_id)
    AND status = 'pending';

  IF v_pending_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Account deletion blocked: You have pending debt agreements waiting for response. Please decline or cancel them before deleting your account.'
    );
  END IF;

  -- 3. Cleanup user relations
  DELETE FROM public.contact_requests WHERE sender_id = v_user_id OR receiver_id = v_user_id;
  DELETE FROM public.contacts WHERE owner_id = v_user_id OR contact_id = v_user_id;
  DELETE FROM public.user_settings WHERE user_id = v_user_id;

  -- 4. Delete payments & logs for settled/declined debts
  DELETE FROM public.payments
  WHERE paid_by = v_user_id
     OR debt_id IN (SELECT id FROM public.debts WHERE lender_id = v_user_id OR borrower_id = v_user_id);

  DELETE FROM public.activity_log
  WHERE user_id = v_user_id
     OR debt_id IN (SELECT id FROM public.debts WHERE lender_id = v_user_id OR borrower_id = v_user_id);

  -- 5. Delete settled or declined debts
  DELETE FROM public.debts
  WHERE lender_id = v_user_id OR borrower_id = v_user_id OR created_by = v_user_id;

  -- 6. Delete profile
  DELETE FROM public.profiles WHERE id = v_user_id;

  -- 7. Delete auth account
  DELETE FROM auth.users WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;
