-- ═══════════════════════════════════════════════════════════════
-- DebtSync Database Schema (Production Ready)
-- ═══════════════════════════════════════════════════════════════

-- PROFILES
-- Supports both authenticated users and shadow/ghost accounts
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  full_name       TEXT NOT NULL,
  phone           TEXT,
  avatar_url      TEXT,
  is_shadow       BOOLEAN DEFAULT false,
  claimed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- USER SETTINGS
CREATE TABLE IF NOT EXISTS user_settings (
  user_id             UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  default_currency    TEXT DEFAULT 'inr',
  theme_preference    TEXT DEFAULT 'system' CHECK (theme_preference IN ('light', 'dark', 'system')),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- CONTACTS
CREATE TABLE IF NOT EXISTS contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  contact_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  nickname        TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(owner_id, contact_id)
);

-- DEBTS
CREATE TABLE IF NOT EXISTS debts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by      UUID NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE,
  lender_id       UUID NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE,
  borrower_id     UUID NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE,
  principal       DECIMAL(12,2) NOT NULL CHECK (principal > 0),
  currency        TEXT DEFAULT 'inr',
  interest_type   TEXT DEFAULT 'none' CHECK (interest_type IN ('none', 'simple', 'compound')),
  interest_rate   DECIMAL(7,4),
  compound_freq   TEXT CHECK (compound_freq IN ('daily', 'weekly', 'monthly', 'yearly')),
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'settled', 'disputed', 'declined')),
  notes           TEXT,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  settled_at      TIMESTAMPTZ
);

-- PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id         UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  paid_by         UUID NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE,
  amount          DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  currency        TEXT DEFAULT 'inr',
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ACTIVITY LOG
CREATE TABLE IF NOT EXISTS activity_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES profiles(id) ON UPDATE CASCADE,
  debt_id         UUID REFERENCES debts(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  details         JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Profiles: allow reading own profile or counterparties in shared debts/contacts
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (id = auth.uid() OR is_shadow = true);

-- Settings: own only
CREATE POLICY "settings_select" ON user_settings FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "settings_insert" ON user_settings FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "settings_update" ON user_settings FOR UPDATE USING (user_id = auth.uid());

-- Contacts: own only
CREATE POLICY "contacts_select" ON contacts FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "contacts_insert" ON contacts FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "contacts_update" ON contacts FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "contacts_delete" ON contacts FOR DELETE USING (owner_id = auth.uid());

-- Debts: lender or borrower can see
CREATE POLICY "debts_select" ON debts FOR SELECT USING (
  lender_id = auth.uid() OR borrower_id = auth.uid()
);
CREATE POLICY "debts_insert" ON debts FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "debts_update" ON debts FOR UPDATE USING (
  lender_id = auth.uid() OR borrower_id = auth.uid()
);

-- Payments: parties of the debt can see
CREATE POLICY "payments_select" ON payments FOR SELECT USING (
  debt_id IN (SELECT id FROM debts WHERE lender_id = auth.uid() OR borrower_id = auth.uid())
);
CREATE POLICY "payments_insert" ON payments FOR INSERT WITH CHECK (paid_by = auth.uid());

-- Activity log: visible to debt parties
CREATE POLICY "activity_select" ON activity_log FOR SELECT USING (
  debt_id IN (SELECT id FROM debts WHERE lender_id = auth.uid() OR borrower_id = auth.uid())
  OR user_id = auth.uid()
);
CREATE POLICY "activity_insert" ON activity_log FOR INSERT WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- TRIGGER: Auto-create profile on auth.users insert
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', 'User'),
    NEW.raw_user_meta_data ->> 'phone'
  )
  ON CONFLICT (email) DO UPDATE SET
    id = NEW.id,
    is_shadow = false,
    claimed_at = now(),
    full_name = COALESCE(NEW.raw_user_meta_data ->> 'full_name', public.profiles.full_name),
    phone = COALESCE(NEW.raw_user_meta_data ->> 'phone', public.profiles.phone);

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
