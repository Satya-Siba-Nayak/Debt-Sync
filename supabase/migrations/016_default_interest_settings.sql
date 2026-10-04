-- Migration: 016_default_interest_settings.sql
-- Description: Adds user preference columns for default interest terms (model, rate, compound frequency)

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS default_interest_type text DEFAULT 'none' CHECK (default_interest_type = ANY (ARRAY['none'::text, 'simple'::text, 'compound'::text])),
  ADD COLUMN IF NOT EXISTS default_interest_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_compound_freq text DEFAULT 'monthly' CHECK (default_compound_freq = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'yearly'::text]));
