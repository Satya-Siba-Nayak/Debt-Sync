-- ═══════════════════════════════════════════════════════════════
-- Migration 013: Admin Roles, UPI IDs, Payment Methods & RLS
-- Safe, Idempotent, and Warning-Free
-- ═══════════════════════════════════════════════════════════════

-- 1. ADD COLUMNS FOR UPI AND ADMIN PRIVILEGES
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS upi_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- 2. ADD COLUMNS FOR DIGITAL PAYMENT METHOD & TRANSACTION REF / UTR
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS transaction_ref TEXT;

-- 3. HELPER FUNCTION TO CHECK IF CURRENT USER IS ADMIN
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- 4. ADMIN PRIVILEGE SECURITY
-- In-app self-promotion is strictly disabled.
-- Administrator privileges MUST ONLY be granted directly through Supabase DB access (SQL Editor or Table Editor):
--
-- To grant admin access to a user, run:
--   UPDATE public.profiles SET is_admin = true WHERE email = 'admin@example.com';
--
-- To revoke admin access:
--   UPDATE public.profiles SET is_admin = false WHERE email = 'admin@example.com';

DROP FUNCTION IF EXISTS public.promote_user_to_admin(TEXT);
DROP FUNCTION IF EXISTS public.promote_user_to_admin();

-- 5. RLS POLICIES FOR ADMIN ACCESS
-- Ensure existing non-admin policies continue to function, while admins can view all platform records

-- Debts: Admins can inspect all debts across the platform
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'debts' AND policyname = 'admin_select_all_debts'
  ) THEN
    CREATE POLICY "admin_select_all_debts" ON public.debts
      FOR SELECT USING (public.is_current_user_admin());
  END IF;
END $$;

-- Payments: Admins can inspect all payments and transaction references
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payments' AND policyname = 'admin_select_all_payments'
  ) THEN
    CREATE POLICY "admin_select_all_payments" ON public.payments
      FOR SELECT USING (public.is_current_user_admin());
  END IF;
END $$;

-- Activity Log: Admins can inspect global activity stream
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'activity_log' AND policyname = 'admin_select_all_activity'
  ) THEN
    CREATE POLICY "admin_select_all_activity" ON public.activity_log
      FOR SELECT USING (public.is_current_user_admin());
  END IF;
END $$;

-- Profiles: Allow users to view profiles (needed for counterparty lookup and admin directory)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'admin_select_all_profiles'
  ) THEN
    CREATE POLICY "admin_select_all_profiles" ON public.profiles
      FOR SELECT USING (true);
  END IF;
END $$;
