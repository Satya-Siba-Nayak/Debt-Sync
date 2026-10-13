export type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  upi_id: string | null;
  preferred_repayment_method?: 'upi' | 'bank_transfer' | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
  bank_account_holder_name?: string | null;
  is_shadow: boolean;
  is_admin: boolean;
  is_super_admin?: boolean;
  is_isolated?: boolean;
  isolation_reason?: string | null;
  is_verified?: boolean;
  needs_reverification?: boolean;
  is_purged?: boolean;
  purged_at?: string | null;
  claimed_at: string | null;
  secondary_emails?: string[];
  recent_custom_avatars?: string[];
  created_at: string;
};

export type UserSettings = {
  user_id: string;
  default_currency: string;
  theme_preference: 'light' | 'dark' | 'system';
  default_country_code?: string;
  default_interest_type?: 'none' | 'simple' | 'compound';
  default_interest_rate?: number;
  default_compound_freq?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  preferred_repayment_method?: 'upi' | 'bank_transfer';
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

export type SplitBillParticipant = {
  userId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  isPayer: boolean;
  shareAmount: number;
  percentage?: number;
  debtId?: string;
  status?: 'pending' | 'active' | 'settled' | 'declined';
};

export type SplitBillDetails = {
  groupId: string;
  title: string;
  totalAmount: number;
  currency: string;
  splitMode: 'equal' | 'exact' | 'percentage';
  payerId: string;
  payerName: string;
  includePayerInSplit: boolean;
  participants: SplitBillParticipant[];
  notes?: string | null;
  createdAt: string;
  interestType?: 'none' | 'simple' | 'compound';
  interestRate?: number | null;
  compoundFreq?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  dueDate?: string | null;
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
  status: 'pending' | 'active' | 'settled' | 'disputed' | 'declined' | 'purged';
  purged_by_admin?: boolean;
  purged_at?: string | null;
  notes: string | null;
  counterparty_notes?: string | null;
  hidden_by?: string[];
  accepted_at: string | null;
  created_at: string;
  settled_at: string | null;
  due_date?: string | null;
  split_group_id?: string | null;
  split_details?: SplitBillDetails | null;
  lender?: Profile;
  borrower?: Profile;
};

export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'gpay' | 'phonepe' | 'paytm' | 'other';

export type Payment = {
  id: string;
  debt_id: string;
  paid_by: string;
  amount: number;
  currency: string;
  note: string | null;
  payment_method: PaymentMethod | null;
  transaction_ref: string | null;
  is_verified?: boolean;
  verified_at?: string | null;
  verified_by?: string | null;
  created_at: string;
  payer?: Profile;
  debt?: Debt;
};

export type ContactRequest = {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  responded_at?: string | null;
  sender?: Profile;
  receiver?: Profile;
};

export type ActivityLogEntry = {
  id: string;
  user_id: string;
  debt_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};
