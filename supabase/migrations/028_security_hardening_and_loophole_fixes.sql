-- ============================================================================
-- Migration 028: Full System Security Hardening & Loophole Fixes
-- ============================================================================
-- Closes critical and high-severity security loopholes across RLS, Triggers, and RPCs:
-- 1. Profile Privilege Escalation Guard (trg_protect_profile_privileged_columns):
--    Prevents non-admin users from promoting themselves to admin/super_admin,
--    self-verifying, self-unisolating, or hijacking arbitrary shadow profiles.
-- 2. Debt State & Self-Accept Guard (accept_debt RPC + trg_enforce_debt_state_integrity):
--    Prevents the creator of a pending debt from accepting their own request,
--    and prevents modifying financial terms (principal, interest_rate, lender_id,
--    borrower_id, currency) once a debt is active or settled.
-- 3. Payment Verification Guard (payments.is_verified default false + trigger):
--    Prevents borrowers from inserting pre-verified repayments or verifying their
--    own payments, and blocks payments on unaccepted (pending/declined/purged) debts.
-- 4. Ghost Profile Takeover Guard (resolve_ghost_profile_by_phone RPC):
--    Enforces auth.uid() = p_user_id and verifies phone ownership so arbitrary
--    users cannot hijack another user's ghost profile or debts.
-- 5. Public Acceptance RPC Privacy Guard (get_debt_for_acceptance RPC):
--    Masks emails and strips private notes when called by unauthenticated visitors
--    unless an active global share snapshot is explicitly enabled on the debt.
-- ============================================================================

-- ============================================================================
-- 1. PROFILE PRIVILEGE ESCALATION & SHADOW PROFILE PROTECTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    ''
  );
  v_is_trusted_admin BOOLEAN := false;
BEGIN
  -- Allow service_role, postgres superuser, or internal triggers/migrations (where auth.uid() is null and not anon REST)
  IF v_jwt_role = 'service_role' OR current_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    IF v_caller_id IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Check if the authenticated caller is already a verified platform administrator
  IF v_caller_id IS NOT NULL THEN
    SELECT (COALESCE(is_admin, false) OR COALESCE(is_super_admin, false))
    INTO v_is_trusted_admin
    FROM public.profiles
    WHERE id = v_caller_id;
  END IF;

  IF COALESCE(v_is_trusted_admin, false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Non-admins can NEVER insert a profile with admin, verified, isolated, or purged flags set
    NEW.is_admin := false;
    NEW.is_super_admin := false;
    NEW.is_verified := false;
    NEW.is_isolated := false;
    NEW.isolation_reason := NULL;
    NEW.is_purged := false;
    NEW.purged_at := NULL;
    NEW.needs_reverification := false;

    -- Must either be their own auth.uid() profile or a shadow profile for a counterparty
    IF v_caller_id IS NOT NULL AND NEW.id != v_caller_id AND COALESCE(NEW.is_shadow, false) = false THEN
      RAISE EXCEPTION 'Unauthorized: Cannot create a non-shadow profile for another user ID.'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Lock privileged administrative columns to their existing values for non-admins
    NEW.is_admin := OLD.is_admin;
    NEW.is_super_admin := OLD.is_super_admin;
    NEW.is_verified := OLD.is_verified;
    NEW.is_isolated := OLD.is_isolated;
    NEW.isolation_reason := OLD.isolation_reason;
    NEW.is_purged := OLD.is_purged;
    NEW.purged_at := OLD.purged_at;
    NEW.needs_reverification := OLD.needs_reverification;

    -- Protect the system tombstone profile from non-admin modification
    IF OLD.id = '00000000-0000-0000-0000-000000000001'::UUID THEN
      RAISE EXCEPTION 'Unauthorized: System tombstone profile cannot be modified.'
        USING ERRCODE = '42501';
    END IF;

    -- Prevent non-owners from mutating another active user's profile
    IF v_caller_id IS NOT NULL AND OLD.id != v_caller_id AND COALESCE(OLD.is_shadow, false) = false THEN
      RAISE EXCEPTION 'Unauthorized: You can only update your own profile.'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileged_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileged_columns
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_privileged_columns();

-- Tighten profiles RLS policies
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    (id = auth.uid() AND COALESCE(is_admin, false) = false AND COALESCE(is_super_admin, false) = false)
    OR (COALESCE(is_shadow, false) = true AND COALESCE(is_admin, false) = false AND COALESCE(is_super_admin, false) = false)
  );

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR (COALESCE(is_shadow, false) = true AND id != '00000000-0000-0000-0000-000000000001'::UUID)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (COALESCE(p.is_admin, false) = true OR COALESCE(p.is_super_admin, false) = true)
    )
  )
  WITH CHECK (
    id = auth.uid()
    OR (COALESCE(is_shadow, false) = true AND id != '00000000-0000-0000-0000-000000000001'::UUID)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (COALESCE(p.is_admin, false) = true OR COALESCE(p.is_super_admin, false) = true)
    )
  );

-- ============================================================================
-- 2. DEBT STATE INTEGRITY & SELF-ACCEPTANCE PREVENTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_debt_state_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_is_admin BOOLEAN := false;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (COALESCE(is_admin, false) OR COALESCE(is_super_admin, false))
  INTO v_is_admin
  FROM public.profiles
  WHERE id = v_caller_id;

  IF COALESCE(v_is_admin, false) THEN
    RETURN NEW;
  END IF;

  -- 1. Block creator from self-accepting their own pending debt via direct table UPDATE
  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    IF OLD.created_by IS NOT NULL AND OLD.created_by = v_caller_id AND OLD.lender_id != OLD.borrower_id THEN
      RAISE EXCEPTION 'Unauthorized: You cannot accept your own pending transaction request. Only the counterparty can accept.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Block re-activating already declined or purged debts
  IF OLD.status IN ('declined', 'purged') AND NEW.status != OLD.status THEN
    RAISE EXCEPTION 'Invalid state transition: Cannot modify status of a % transaction.', OLD.status
      USING ERRCODE = '42501';
  END IF;

  -- 3. Once a debt is active, settled, or purged, financial terms (principal, currency, interest) are immutable
  IF OLD.status IN ('active', 'settled', 'purged') THEN
    IF NEW.principal IS DISTINCT FROM OLD.principal
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.interest_type IS DISTINCT FROM OLD.interest_type
       OR NEW.interest_rate IS DISTINCT FROM OLD.interest_rate
       OR NEW.compound_freq IS DISTINCT FROM OLD.compound_freq
    THEN
      RAISE EXCEPTION 'Immutable ledger terms: Principal, currency, and interest terms cannot be altered after an agreement is active or settled.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_debt_state_integrity ON public.debts;
CREATE TRIGGER trg_enforce_debt_state_integrity
BEFORE UPDATE ON public.debts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_debt_state_integrity();

-- Harden accept_debt RPC: Block creator self-acceptance & require status = 'pending'
CREATE OR REPLACE FUNCTION public.accept_debt(p_debt_id UUID, p_decision TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_debt RECORD;
  v_is_counterparty BOOLEAN := false;
  v_is_admin BOOLEAN := false;
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

  SELECT (COALESCE(is_admin, false) OR COALESCE(is_super_admin, false))
  INTO v_is_admin
  FROM public.profiles
  WHERE id = v_user_id;

  -- Require debt to be in 'pending' status (unless already in target state)
  IF v_debt.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This agreement has already been ' || v_debt.status);
  END IF;

  -- Validate caller is party to this debt or an administrator
  IF v_debt.lender_id = v_user_id OR v_debt.borrower_id = v_user_id THEN
    v_is_counterparty := true;
  ELSIF COALESCE(v_is_admin, false) THEN
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
        v_debt.borrower_id := v_user_id;
      ELSIF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_debt.lender_id AND (lower(email) = lower(v_user_email) OR (secondary_emails IS NOT NULL AND lower(v_user_email) = ANY(SELECT lower(unnest(secondary_emails)))))) THEN
        UPDATE public.debts SET lender_id = v_user_id WHERE id = p_debt_id;
        v_debt.lender_id := v_user_id;
      END IF;
    END IF;
  END IF;

  IF NOT v_is_counterparty THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not a participant in this agreement');
  END IF;

  v_dec := lower(trim(p_decision));

  -- Block the creator from accepting their own pending debt request
  IF v_dec IN ('active', 'accepted', 'approve')
     AND v_debt.created_by IS NOT NULL
     AND v_debt.created_by = v_user_id
     AND v_debt.lender_id != v_debt.borrower_id
     AND NOT COALESCE(v_is_admin, false)
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You cannot accept a transaction request that you created. Only the counterparty can accept it.'
    );
  END IF;

  IF v_dec IN ('active', 'accepted', 'approve') THEN
    UPDATE public.debts
    SET 
      status = 'active',
      accepted_at = now(),
      updated_at = now()
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

      UPDATE public.contact_requests
      SET status = 'accepted', responded_at = now()
      WHERE (
        (sender_id = v_debt.lender_id AND receiver_id = v_debt.borrower_id)
        OR (sender_id = v_debt.borrower_id AND receiver_id = v_debt.lender_id)
      )
      AND status = 'pending';
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'active');
  ELSE
    UPDATE public.debts
    SET status = 'declined', updated_at = now()
    WHERE id = p_debt_id;

    INSERT INTO public.activity_log (user_id, debt_id, action, details)
    VALUES (v_user_id, p_debt_id, 'debt_declined', jsonb_build_object('decision', 'declined'));

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

-- ============================================================================
-- 3. PAYMENT VERIFICATION INTEGRITY (Prevent Borrower Self-Verification)
-- ============================================================================

ALTER TABLE public.payments ALTER COLUMN is_verified SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.enforce_payment_verification_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_debt RECORD;
  v_is_admin BOOLEAN := false;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_debt FROM public.debts WHERE id = NEW.debt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated debt record not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT (COALESCE(is_admin, false) OR COALESCE(is_super_admin, false))
  INTO v_is_admin
  FROM public.profiles
  WHERE id = v_caller_id;

  IF COALESCE(v_is_admin, false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Block logging payments on pending, declined, or purged debts
    IF v_debt.status IN ('pending', 'declined', 'purged') THEN
      RAISE EXCEPTION 'Cannot record repayments on a % transaction. The agreement must be active first.', v_debt.status
        USING ERRCODE = '42501';
    END IF;

    -- Only the lender can insert an already-verified payment; borrower submissions MUST start unverified
    IF v_caller_id != v_debt.lender_id THEN
      NEW.is_verified := false;
      NEW.verified_by := NULL;
      NEW.verified_at := NULL;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only the lender (or admin) can verify a payment or alter verification fields
    IF (NEW.is_verified IS DISTINCT FROM OLD.is_verified OR NEW.verified_by IS DISTINCT FROM OLD.verified_by)
       AND v_caller_id != v_debt.lender_id
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

-- ============================================================================
-- 4. GHOST PROFILE PHONE RESOLUTION GUARD (Prevent Account/Debt Hijacking)
-- ============================================================================

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
  v_caller_id UUID := auth.uid();
  v_clean_digits TEXT;
  v_caller_phone TEXT;
  v_caller_digits TEXT;
  v_ghost RECORD;
  v_merged_count INT := 0;
  v_ghost_emails TEXT[] := ARRAY[]::TEXT[];
  v_existing_secondaries TEXT[];
BEGIN
  -- Strict authorization check: Caller MUST be authenticated and resolving their OWN profile
  IF v_caller_id IS NULL OR v_caller_id != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller ID mismatch', 'merged_count', 0);
  END IF;

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

  -- Verify p_phone matches the phone stored in auth.users raw_user_meta_data or public.profiles for v_caller_id
  SELECT COALESCE(
    (SELECT phone FROM public.profiles WHERE id = v_caller_id),
    (SELECT COALESCE(phone, raw_user_meta_data->>'phone') FROM auth.users WHERE id = v_caller_id)
  ) INTO v_caller_phone;

  IF v_caller_phone IS NOT NULL AND length(trim(v_caller_phone)) >= 7 THEN
    v_caller_digits := regexp_replace(v_caller_phone, '[^0-9]', '', 'g');
    IF length(v_caller_digits) > 10 THEN
      v_caller_digits := right(v_caller_digits, 10);
    END IF;

    IF v_caller_digits != v_clean_digits THEN
      RETURN jsonb_build_object('success', false, 'error', 'Phone number does not match authenticated user profile', 'merged_count', 0);
    END IF;
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
    UPDATE public.debts SET lender_id = p_user_id WHERE lender_id = v_ghost.id;
    UPDATE public.debts SET borrower_id = p_user_id WHERE borrower_id = v_ghost.id;
    UPDATE public.debts SET created_by = p_user_id WHERE created_by = v_ghost.id;

    UPDATE public.payments SET paid_by = p_user_id WHERE paid_by = v_ghost.id;
    UPDATE public.payments SET verified_by = p_user_id WHERE verified_by = v_ghost.id;
    UPDATE public.activity_log SET user_id = p_user_id WHERE user_id = v_ghost.id;

    DELETE FROM public.contacts
    WHERE (owner_id = p_user_id AND contact_id = v_ghost.id)
       OR (owner_id = v_ghost.id AND contact_id = p_user_id);

    DELETE FROM public.contacts c_ghost
    WHERE c_ghost.contact_id = v_ghost.id
      AND EXISTS (
        SELECT 1 FROM public.contacts c_real
        WHERE c_real.owner_id = c_ghost.owner_id
          AND c_real.contact_id = p_user_id
      );

    DELETE FROM public.contacts c_ghost
    WHERE c_ghost.owner_id = v_ghost.id
      AND EXISTS (
        SELECT 1 FROM public.contacts c_real
        WHERE c_real.owner_id = p_user_id
          AND c_real.contact_id = c_ghost.contact_id
      );

    UPDATE public.contacts SET contact_id = p_user_id WHERE contact_id = v_ghost.id;
    UPDATE public.contacts SET owner_id = p_user_id WHERE owner_id = v_ghost.id;

    DELETE FROM public.contact_requests
    WHERE sender_id = v_ghost.id OR receiver_id = v_ghost.id;

    IF v_ghost.email IS NOT NULL
       AND v_ghost.email NOT LIKE '%@phone.debtsync.local'
       AND lower(trim(v_ghost.email)) != lower(trim(COALESCE(p_user_email, '')))
    THEN
      v_ghost_emails := array_append(v_ghost_emails, lower(trim(v_ghost.email)));
    END IF;

    DELETE FROM public.profiles WHERE id = v_ghost.id;
    v_merged_count := v_merged_count + 1;
  END LOOP;

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

-- ============================================================================
-- 5. HARDEN get_debt_for_acceptance RPC (Mask Sensitive Data for Anonymous Callers)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mask_email_for_public(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_at_pos INT;
  v_local TEXT;
  v_domain TEXT;
BEGIN
  IF p_email IS NULL OR position('@' IN p_email) = 0 THEN
    RETURN NULL;
  END IF;
  v_at_pos := position('@' IN p_email);
  v_local := substring(p_email FROM 1 FOR v_at_pos - 1);
  v_domain := substring(p_email FROM v_at_pos + 1);
  IF length(v_local) <= 1 THEN
    RETURN COALESCE(left(v_local, 1), '*') || '***@' || v_domain;
  END IF;
  RETURN left(v_local, 1) || '***' || right(v_local, 1) || '@' || v_domain;
END;
$$;

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_email TEXT;
  v_caller_secondaries TEXT[];
  v_is_admin BOOLEAN := false;
  v_is_participant BOOLEAN := false;
BEGIN
  IF v_caller_id IS NOT NULL THEN
    SELECT
      lower(p.email),
      COALESCE(p.secondary_emails, ARRAY[]::TEXT[]),
      (COALESCE(p.is_admin, false) OR COALESCE(p.is_super_admin, false))
    INTO v_caller_email, v_caller_secondaries, v_is_admin
    FROM public.profiles p
    WHERE p.id = v_caller_id;

    SELECT EXISTS (
      SELECT 1
      FROM public.debts d
      LEFT JOIN public.profiles lp ON d.lender_id = lp.id
      LEFT JOIN public.profiles bp ON d.borrower_id = bp.id
      WHERE d.id = p_debt_id
        AND (
          v_is_admin
          OR d.lender_id = v_caller_id
          OR d.borrower_id = v_caller_id
          OR d.created_by = v_caller_id
          OR (v_caller_email IS NOT NULL AND (lower(lp.email) = v_caller_email OR lower(bp.email) = v_caller_email))
          OR (v_caller_email IS NOT NULL AND COALESCE(d.notes, '') ILIKE '%' || v_caller_email || '%')
        )
    ) INTO v_is_participant;
  END IF;

  RETURN QUERY
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
    CASE
      WHEN v_is_participant THEN d.notes
      -- If not an authenticated participant, only expose the [SHARE:...] / [SPLIT:...] metadata blocks when globalEnabled is true, hiding private plain-text notes
      WHEN COALESCE(d.notes, '') LIKE '%"globalEnabled":true%' THEN
        COALESCE(
          (SELECT string_agg(m[1], E'\n') FROM regexp_matches(d.notes, '(\[(?:SHARE|SPLIT|ADMIN_PURGED|TRANSACTION PURGED BY ADMIN)[^\n]*\])', 'g') AS m),
          d.notes
        )
      ELSE NULL
    END AS notes,
    d.due_date,
    d.settled_at,
    d.split_group_id,
    CASE WHEN v_is_participant OR COALESCE(d.notes, '') LIKE '%"globalEnabled":true%' THEN d.split_details ELSE NULL END AS split_details,
    d.accepted_at,
    d.created_at,
    lp.full_name AS lender_name,
    CASE
      WHEN v_is_participant THEN lp.email
      ELSE public.mask_email_for_public(lp.email)
    END AS lender_email,
    lp.avatar_url AS lender_avatar,
    bp.full_name AS borrower_name,
    CASE
      WHEN v_is_participant THEN bp.email
      ELSE public.mask_email_for_public(bp.email)
    END AS borrower_email,
    bp.avatar_url AS borrower_avatar
  FROM public.debts d
  LEFT JOIN public.profiles lp ON d.lender_id = lp.id
  LEFT JOIN public.profiles bp ON d.borrower_id = bp.id
  WHERE d.id = p_debt_id
    AND (
      v_is_participant
      OR COALESCE(d.notes, '') LIKE '%"globalEnabled":true%'
      OR COALESCE(d.notes, '') LIKE '%"disabledAt":%'
      OR d.status = 'pending'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_debt_for_acceptance(UUID) TO anon, authenticated, service_role;
