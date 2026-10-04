-- ═══════════════════════════════════════════════════════════════
-- Migration 017: Preferred Repayment Method & Bank Account Details
-- Safe, Idempotent, and Warning-Free
-- ═══════════════════════════════════════════════════════════════

-- 1. ADD REPAYMENT PREFERENCE & BANK DETAILS TO PROFILES
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_repayment_method TEXT DEFAULT 'upi';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bank_ifsc TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bank_account_holder_name TEXT;

-- 2. ADD REPAYMENT PREFERENCE TO USER_SETTINGS
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS preferred_repayment_method TEXT DEFAULT 'upi';
