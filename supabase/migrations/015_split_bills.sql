-- ═══════════════════════════════════════════════════════════════
-- Migration 015: Native Split Bills & Group Expenses
-- Safe, Idempotent, and Warning-Free
-- ═══════════════════════════════════════════════════════════════

-- 1. ADD SPLIT BILL METADATA COLUMNS TO DEBTS TABLE
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS split_group_id UUID DEFAULT NULL;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS split_details JSONB DEFAULT NULL;

-- 2. CREATE PERFORMANCE INDEX FOR SPLIT GROUP QUERIES
CREATE INDEX IF NOT EXISTS idx_debts_split_group_id ON public.debts(split_group_id) WHERE split_group_id IS NOT NULL;

-- 3. COMMENT ON COLUMNS FOR TRANSPARENCY
COMMENT ON COLUMN public.debts.split_group_id IS 'Unique identifier grouping all individual peer debt shares created from a single split bill expense.';
COMMENT ON COLUMN public.debts.split_details IS 'JSON payload containing the original split bill total, title, payer info, and full participant breakdown.';
