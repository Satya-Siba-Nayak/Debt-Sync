export type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  is_shadow: boolean;
  claimed_at: string | null;
  secondary_emails?: string[];
  created_at: string;
};

export type UserSettings = {
  user_id: string;
  default_currency: string;
  theme_preference: 'light' | 'dark' | 'system';
  default_country_code?: string;
  created_at: string;
  updated_at: string;
};

export type Contact = {
  id: string;
  owner_id: string;
  contact_id: string;
  nickname: string | null;
  created_at: string;
  profile?: Profile;
};

export type Debt = {
  id: string;
  created_by: string;
  lender_id: string;
  borrower_id: string;
  principal: number;
  currency: string;
  interest_type: 'none' | 'simple' | 'compound';
  interest_rate: number | null;
  compound_freq: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  status: 'pending' | 'active' | 'settled' | 'disputed' | 'declined';
  notes: string | null;
  accepted_at: string | null;
  created_at: string;
  settled_at: string | null;
  due_date?: string | null;
  lender?: Profile;
  borrower?: Profile;
};

export type Payment = {
  id: string;
  debt_id: string;
  paid_by: string;
  amount: number;
  currency: string;
  note: string | null;
  created_at: string;
};

export type ActivityLogEntry = {
  id: string;
  user_id: string;
  debt_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};
