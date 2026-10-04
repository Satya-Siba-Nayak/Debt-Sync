'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency, SUPPORTED_CURRENCIES } from '@/lib/utils/currency';
import { round2 } from '@/lib/utils/interest';
import { calculateEqualSplit, buildSplitNotes } from '@/lib/utils/split-bills';
import { SplitBillDetails, SplitBillParticipant } from '@/lib/types/database';
import { findProfileByIdentifier, searchProfiles } from '@/lib/utils/profile-lookup';
import { checkDebtRequestCooldown, invalidateCooldownCache } from '@/lib/utils/debt-cooldown';
import { sendNotificationEmail } from '@/lib/utils/email-notifier';
import { PhoneInput } from '../ui/PhoneInput';
import { Avatar } from '../ui/Avatar';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { getLedgerCache, invalidateLedgerCache } from '@/lib/stores/ledger-store';

export interface SplitPersonOption {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  isPlatformUser?: boolean;
}

export interface SplitBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSplitCreated?: () => void;
  onSwitchToSingle?: () => void;
}

const CATEGORY_SUGGESTIONS = [
  { label: 'Dinner', icon: 'restaurant' },
  { label: 'Drinks', icon: 'local_bar' },
  { label: 'Groceries', icon: 'shopping_cart' },
  { label: 'Trip / Stay', icon: 'flight' },
  { label: 'Uber / Cab', icon: 'local_taxi' },
  { label: 'Rent', icon: 'home' },
  { label: 'Utilities', icon: 'bolt' },
];

export function SplitBillModal({
  isOpen,
  onClose,
  onSplitCreated,
  onSwitchToSingle,
}: SplitBillModalProps) {
  const supabase = createClient();

  // Current user state
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; email: string; avatar_url?: string | null } | null>(null);
  const [isCurrentUserIsolated, setIsCurrentUserIsolated] = useState(false);

  // Form inputs
  const [title, setTitle] = useState('');
  const [totalAmountStr, setTotalAmountStr] = useState('1500');
  const [totalAmount, setTotalAmount] = useState<number>(1500);
  const [currency, setCurrency] = useState('inr');
  const [includeSelf, setIncludeSelf] = useState(true);
  const [transactionDate, setTransactionDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  // Terms & Interest states
  const [interestType, setInterestType] = useState<'none' | 'simple' | 'compound'>('none');
  const [interestRateStr, setInterestRateStr] = useState<string>('5.00');
  const [interestRate, setInterestRate] = useState<number>(5.0);
  const [compoundFreq, setCompoundFreq] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [dueDate, setDueDate] = useState('');

  // Participants
  const [contacts, setContacts] = useState<SplitPersonOption[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<SplitPersonOption[]>([]);

  // Search & add new person
  const [personSearch, setPersonSearch] = useState('');
  const [platformSearchResults, setPlatformSearchResults] = useState<SplitPersonOption[]>([]);
  const [isSearchingPlatform, setIsSearchingPlatform] = useState(false);
  const [isAddingNewPerson, setIsAddingNewPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonEmail, setNewPersonEmail] = useState('');
  const [newPersonPhone, setNewPersonPhone] = useState('');
  const [defaultCountryCode, setDefaultCountryCode] = useState('+91');

  // Submission state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 1. Load initial user and contacts on open
  useEffect(() => {
    if (!isOpen) return;

    async function loadData() {
      try {
        const user = await getCurrentUserFast(supabase);
        if (!user) return;

        setCurrentUser({
          id: user.id,
          name: user.user_metadata?.full_name || user.email || 'You',
          email: user.email || '',
          avatar_url: user.user_metadata?.avatar_url || null,
        });

        // Check user settings for default currency & country code
        const { data: settings } = await supabase
          .from('user_settings')
          .select('default_currency, default_country_code')
          .eq('user_id', user.id)
          .single();

        if (settings?.default_currency) setCurrency(settings.default_currency);
        if (settings?.default_country_code) setDefaultCountryCode(settings.default_country_code);

        // Check profile isolation
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_isolated')
          .eq('id', user.id)
          .single();
        setIsCurrentUserIsolated(Boolean(profile?.is_isolated));

        // Load contacts from cache or DB
        const peopleMap = new Map<string, SplitPersonOption>();
        const cached = getLedgerCache();
        if (cached?.people) {
          for (const p of cached.people) {
            peopleMap.set(p.id, {
              id: p.id,
              name: p.name,
              email: p.email,
              phone: p.phone,
              avatar_url: p.avatarUrl,
            });
          }
        }

        const [contactsRes, debtsRes] = await Promise.all([
          supabase
            .from('contacts')
            .select(`
              contact_id, nickname,
              profile:profiles!contacts_contact_id_fkey(id, email, full_name, phone, avatar_url)
            `)
            .eq('owner_id', user.id),
          supabase
            .from('debts')
            .select(`
              lender_id, borrower_id,
              lender:profiles!debts_lender_id_fkey(id, email, full_name, phone, avatar_url),
              borrower:profiles!debts_borrower_id_fkey(id, email, full_name, phone, avatar_url)
            `)
            .or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`)
            .neq('status', 'declined'),
        ]);

        if (contactsRes.data) {
          for (const c of contactsRes.data as any[]) {
            if (c.profile) {
              peopleMap.set(c.contact_id, {
                id: c.contact_id,
                name: c.nickname || c.profile.full_name || c.profile.email,
                email: c.profile.email,
                phone: c.profile.phone,
                avatar_url: c.profile.avatar_url,
              });
            }
          }
        }

        if (debtsRes.data) {
          for (const d of debtsRes.data as any[]) {
            const isLender = d.lender_id === user.id;
            const other = isLender ? d.borrower : d.lender;
            if (other && other.id !== user.id && !peopleMap.has(other.id)) {
              peopleMap.set(other.id, {
                id: other.id,
                name: other.full_name || other.email,
                email: other.email,
                phone: other.phone,
                avatar_url: other.avatar_url,
              });
            }
          }
        }

        setContacts(Array.from(peopleMap.values()));
      } catch (err) {
        console.error('Error loading split bill data:', err);
      }
    }

    loadData();
  }, [isOpen, supabase]);

  // Search platform users debounced
  useEffect(() => {
    if (!personSearch.trim() || personSearch.trim().length < 2) {
      setPlatformSearchResults([]);
      setIsSearchingPlatform(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingPlatform(true);
      try {
        const results = await searchProfiles(personSearch);
        const mapped: SplitPersonOption[] = results
          .filter((p) => p.id !== currentUser?.id)
          .map((p) => ({
            id: p.id,
            name: p.full_name || p.email,
            email: p.email,
            phone: p.phone,
            avatar_url: p.avatar_url,
            isPlatformUser: true,
          }));
        setPlatformSearchResults(mapped);
      } catch (err) {
        console.warn('Platform search failed:', err);
      } finally {
        setIsSearchingPlatform(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [personSearch, currentUser?.id]);

  const handleAmountChange = (val: string) => {
    const sanitized = val.replace(/^0+(?=\d)/, '');
    setTotalAmountStr(sanitized);
    setTotalAmount(parseFloat(sanitized) || 0);
  };

  const handleInterestRateChange = (val: string) => {
    setInterestRateStr(val);
    const parsed = parseFloat(val);
    setInterestRate(isNaN(parsed) ? 0 : parsed);
  };

  // Toggle or add participant
  const handleToggleParticipant = (person: SplitPersonOption) => {
    setSelectedParticipants((prev) => {
      const exists = prev.some((p) => p.id === person.id);
      if (exists) {
        return prev.filter((p) => p.id !== person.id);
      }
      return [...prev, person];
    });
    setPersonSearch('');
  };

  const handleRemoveParticipant = (personId: string) => {
    setSelectedParticipants((prev) => prev.filter((p) => p.id !== personId));
  };

  // Add new person inline
  const handleAddNewPersonSubmit = async () => {
    if (!newPersonName.trim()) {
      setError('Please provide a name for the new contact.');
      return;
    }
    const cleanPhone = newPersonPhone.trim();
    const phoneDigits = cleanPhone.replace(/[^\d]/g, '');
    if (!cleanPhone || phoneDigits.length < 7) {
      setError('A valid phone number is required to add a contact.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const targetEmail = newPersonEmail.trim().toLowerCase();
      const targetPhone = cleanPhone;

      const existingProfile = targetEmail
        ? await findProfileByIdentifier(targetEmail)
        : await findProfileByIdentifier(targetPhone);

      let targetId = '';
      if (existingProfile) {
        targetId = existingProfile.id;
      } else {
        const shadowId = crypto.randomUUID();
        const fallbackEmail = targetEmail || `${targetPhone.replace(/[^\d]/g, '')}@phone.debtsync.local`;
        const finalName = newPersonName.trim();
        const { error: shadowError } = await supabase.from('profiles').insert({
          id: shadowId,
          email: fallbackEmail,
          full_name: finalName,
          phone: targetPhone || null,
          is_shadow: true,
        });
        if (shadowError) throw shadowError;
        targetId = shadowId;
      }

      const newPerson: SplitPersonOption = {
        id: targetId,
        name: newPersonName.trim(),
        email: targetEmail || null,
        phone: targetPhone,
      };

      setContacts((prev) => [newPerson, ...prev.filter((p) => p.id !== targetId)]);
      setSelectedParticipants((prev) => [...prev.filter((p) => p.id !== targetId), newPerson]);

      // Reset inline form
      setNewPersonName('');
      setNewPersonEmail('');
      setNewPersonPhone('');
      setIsAddingNewPerson(false);
      setPersonSearch('');
    } catch (err: any) {
      setError(err.message || 'Failed to add new contact.');
    } finally {
      setLoading(false);
    }
  };

  // Math Calculations: Equal Split
  const totalCount = selectedParticipants.length + (includeSelf ? 1 : 0);
  const shares = useMemo(() => {
    if (totalCount <= 0 || totalAmount <= 0) return [];
    return calculateEqualSplit(totalAmount, totalCount);
  }, [totalAmount, totalCount]);

  // Compute each participant's share amount
  const myShare = includeSelf ? (shares[0] || 0) : 0;
  const participantShares = useMemo(() => {
    const startIndex = includeSelf ? 1 : 0;
    return selectedParticipants.map((p, idx) => ({
      ...p,
      shareAmount: shares[startIndex + idx] || 0,
    }));
  }, [selectedParticipants, shares, includeSelf]);

  const totalOwedToMe = round2(participantShares.reduce((s, p) => s + p.shareAmount, 0));

  // Filtered contacts matching search
  const filteredContacts = useMemo(() => {
    if (!personSearch.trim()) return [];
    const q = personSearch.toLowerCase();
    const existingIds = new Set(selectedParticipants.map((p) => p.id));
    return contacts.filter(
      (c) =>
        !existingIds.has(c.id) &&
        ((c.name && c.name.toLowerCase().includes(q)) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.phone && c.phone.includes(q)))
    );
  }, [contacts, personSearch, selectedParticipants]);

  // Frequent quick-select chips (first 4 contacts not yet added)
  const quickPickContacts = useMemo(() => {
    const selectedIds = new Set(selectedParticipants.map((p) => p.id));
    return contacts.filter((c) => !selectedIds.has(c.id)).slice(0, 5);
  }, [contacts, selectedParticipants]);

  // Submit Split Bill
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isCurrentUserIsolated) {
      setError('Your account is quarantined in security isolation. Transaction recording is restricted.');
      return;
    }

    if (totalAmount <= 0) {
      setError('Please enter a valid bill amount greater than zero.');
      return;
    }

    if (!title.trim()) {
      setError('Please provide a title or description for this expense (e.g. Dinner, Groceries).');
      return;
    }

    if (selectedParticipants.length === 0) {
      setError('Please add at least one person to split the bill with.');
      return;
    }

    if (!includeSelf && selectedParticipants.length < 2) {
      setError('When not including yourself, add at least two people to split the bill between.');
      return;
    }

    setLoading(true);

    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) throw new Error('User session expired. Please sign in again.');

      // Check anti-harassment cooldown for all selected participants
      for (const p of selectedParticipants) {
        const cooldownCheck = await checkDebtRequestCooldown(supabase, p.id);
        if (!cooldownCheck.allowed) {
          throw new Error(
            `Cannot split bill with ${p.name}: ${cooldownCheck.message || 'Request cooldown is active.'}`
          );
        }
      }

      const groupId = crypto.randomUUID();
      const originationDate = transactionDate ? new Date(transactionDate + 'T12:00:00Z') : new Date();

      // Build complete participant metadata for group transparency
      const fullParticipantsList: SplitBillParticipant[] = [];

      if (includeSelf) {
        fullParticipantsList.push({
          userId: user.id,
          name: currentUser?.name || 'Organizer',
          email: currentUser?.email || null,
          avatarUrl: currentUser?.avatar_url || null,
          isPayer: true,
          shareAmount: myShare,
          status: 'settled', // Payer has already paid their share
        });
      }

      for (const p of participantShares) {
        fullParticipantsList.push({
          userId: p.id,
          name: p.name,
          email: p.email || null,
          phone: p.phone || null,
          avatarUrl: p.avatar_url || null,
          isPayer: false,
          shareAmount: p.shareAmount,
          status: 'pending',
        });
      }

      const splitDetails: SplitBillDetails = {
        groupId,
        title: title.trim(),
        totalAmount: round2(totalAmount),
        currency,
        splitMode: 'equal',
        payerId: user.id,
        payerName: currentUser?.name || 'Organizer',
        includePayerInSplit: includeSelf,
        participants: fullParticipantsList,
        notes: notes.trim() || null,
        createdAt: originationDate.toISOString(),
        interestType,
        interestRate: interestType !== 'none' ? interestRate : null,
        compoundFreq: interestType === 'compound' ? compoundFreq : null,
        dueDate: dueDate ? new Date(dueDate + 'T23:59:59Z').toISOString() : null,
      };

      const encodedNotes = buildSplitNotes(splitDetails, notes);

      // Create individual debt requests for each participant
      for (const p of participantShares) {
        let debtCreated = false;

        const debtPayload = {
          created_by: user.id,
          lender_id: user.id,
          borrower_id: p.id,
          principal: p.shareAmount,
          currency,
          interest_type: interestType,
          interest_rate: interestType !== 'none' ? interestRate : null,
          compound_freq: interestType === 'compound' ? compoundFreq : null,
          due_date: dueDate ? new Date(dueDate + 'T23:59:59Z').toISOString() : null,
          status: 'pending',
          notes: encodedNotes,
          created_at: originationDate.toISOString(),
        };

        // 1. Attempt first with native split_group_id & split_details columns
        try {
          const { error: insertErr } = await supabase.from('debts').insert({
            ...debtPayload,
            split_group_id: groupId,
            split_details: splitDetails,
          });

          if (!insertErr) {
            debtCreated = true;
          }
        } catch (_) {
          // Column might not exist in database yet before migration
        }

        // 2. Fallback without new columns if schema migration not yet applied
        if (!debtCreated) {
          const { error: fallbackErr } = await supabase.from('debts').insert(debtPayload);
          if (fallbackErr) throw fallbackErr;
        }

        // Invalidate cooldown cache for target
        invalidateCooldownCache(p.id);

        // Send split bill email notification if recipient has email
        if (p.email && !p.email.endsWith('@phone.debtsync.local')) {
          sendNotificationEmail({
            type: 'split_bill_request',
            recipientEmail: p.email,
            recipientName: p.name,
            senderName: currentUser?.name || 'A friend',
            amount: p.shareAmount,
            currency,
            notes: `Split: "${title.trim()}" (Total: ${currency.toUpperCase()} ${totalAmount})${
              interestType !== 'none' ? ` • ${interestRate}% ${interestType} APR` : ''
            }`,
          });
        }
      }

      // Log activity for the group split
      await supabase.from('activity_log').insert({
        user_id: user.id,
        action: 'debt_split_created',
        details: {
          groupId,
          title: title.trim(),
          totalAmount: round2(totalAmount),
          currency,
          includeSelf,
          totalParticipants: totalCount,
          participantCount: selectedParticipants.length,
          totalOwedToYou: totalOwedToMe,
          interestType,
          interestRate: interestType !== 'none' ? interestRate : null,
          compoundFreq: interestType === 'compound' ? compoundFreq : null,
          dueDate: dueDate || null,
          participants: fullParticipantsList.map((pt) => ({
            id: pt.userId,
            name: pt.name,
            share: pt.shareAmount,
            isPayer: pt.isPayer,
          })),
        },
      });

      invalidateLedgerCache();
      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      onSplitCreated?.();
      onClose();
    } catch (err: any) {
      console.error('Error creating split bill:', err);
      setError(err.message || 'Failed to create split bill agreements.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Split Bill & Group Expenses"
      subtitle="Equally divide an expense across multiple friends with automatic tracking"
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Tab Switcher: Single vs Split Bill */}
        <div className="flex bg-[var(--surface-container-low)] p-1 rounded-xl border border-[var(--outline-variant)]/25">
          <button
            type="button"
            onClick={onSwitchToSingle}
            className="flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-medium text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">person</span>
            <span>Single Transaction</span>
          </button>
          <button
            type="button"
            className="flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-bold bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-xs transition-all flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">call_split</span>
            <span>Split Bill</span>
          </button>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-[var(--error)] text-xs font-mono flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
            <span>{error}</span>
          </div>
        )}

        {isCurrentUserIsolated && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 font-mono text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">security</span>
            <span>Your account is currently quarantined in security isolation. Creating transactions is restricted.</span>
          </div>
        )}

        {/* 1. Bill Title & Category Chips */}
        <div>
          <label className="block font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold mb-1.5">
            Expense Title <span className="text-[var(--error)]">*</span>
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Dinner at Taj, Goa Airbnb, Groceries"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-base md:text-sm font-body-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
          />

          {/* Quick Category Chips */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[11px] font-mono text-[var(--on-surface-variant)] mr-1">Quick:</span>
            {CATEGORY_SUGGESTIONS.map((cat) => (
              <button
                key={cat.label}
                type="button"
                onClick={() => setTitle(cat.label)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono border transition-all flex items-center gap-1 cursor-pointer ${
                  title === cat.label
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)]'
                    : 'bg-[var(--surface-container-low)] text-[var(--on-surface-variant)] border-[var(--outline-variant)]/20 hover:border-[var(--outline-variant)]'
                }`}
              >
                <span className="material-symbols-outlined text-[13px]">{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 2. Total Bill Amount & Currency */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold mb-1.5">
              Total Amount Paid <span className="text-[var(--error)]">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm font-bold text-[var(--on-surface-variant)]">
                {currency === 'inr' ? '₹' : currency.toUpperCase()}
              </span>
              <input
                type="number"
                min="0.01"
                step="any"
                required
                value={totalAmountStr}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="1500"
                className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-base md:text-sm font-mono font-bold outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30"
              />
            </div>
          </div>

          <div>
            <label className="block font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold mb-1.5">
              Currency
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-base md:text-sm font-mono outline-none focus:border-[var(--primary)]"
            >
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code.toUpperCase()} ({c.symbol})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 3. Include Self Toggle */}
        <div className="p-3.5 rounded-xl border border-[var(--outline-variant)]/30 bg-[var(--surface-container-low)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/15 text-[var(--primary)] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">person_check</span>
            </div>
            <div>
              <p className="font-heading text-xs font-bold text-[var(--on-surface)]">
                Include myself in split calculation
              </p>
              <p className="font-mono text-[11px] text-[var(--on-surface-variant)] mt-0.5">
                {includeSelf
                  ? `You are sharing the bill equally with everyone (${totalCount} people total)`
                  : `You paid on behalf of others (split 100% among the ${selectedParticipants.length} participant${selectedParticipants.length > 1 ? 's' : ''})`}
              </p>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={includeSelf}
              onChange={(e) => setIncludeSelf(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-[var(--outline-variant)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--primary)]" />
          </label>
        </div>

        {/* 4. Split Financial Preview Bento */}
        {totalAmount > 0 && totalCount > 0 && (
          <div className="p-4 rounded-xl border border-[var(--primary)]/25 bg-[var(--primary)]/5 space-y-3">
            <div className="flex justify-between items-center text-xs font-mono flex-wrap gap-2">
              <span className="font-bold text-[var(--on-surface)] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">calculate</span>
                <span>Split Breakdown ({totalCount} People)</span>
              </span>
              <div className="flex items-center gap-2">
                {interestType !== 'none' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">trending_up</span>
                    <span>+{interestRate}% {interestType.toUpperCase()} APR</span>
                  </span>
                )}
                <span className="text-[var(--primary)] font-bold">
                  {formatCurrency(totalAmount, currency)} Total
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
              <div className="bg-[var(--surface-container-lowest)] p-2.5 rounded-lg border border-[var(--outline-variant)]/20">
                <span className="text-[10px] text-[var(--on-surface-variant)] uppercase block">Each Share</span>
                <span className="font-bold text-sm text-[var(--on-surface)]">
                  {formatCurrency(shares[0] || 0, currency)}
                </span>
              </div>

              {includeSelf && (
                <div className="bg-[var(--surface-container-lowest)] p-2.5 rounded-lg border border-[var(--outline-variant)]/20">
                  <span className="text-[10px] text-[var(--on-surface-variant)] uppercase block">Your Share (Paid)</span>
                  <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(myShare, currency)}
                  </span>
                </div>
              )}

              <div className="bg-[var(--surface-container-lowest)] p-2.5 rounded-lg border border-[var(--outline-variant)]/20 col-span-2 sm:col-span-1">
                <span className="text-[10px] text-[var(--on-surface-variant)] uppercase block">You Will Be Owed</span>
                <span className="font-bold text-sm text-[var(--secondary)]">
                  {formatCurrency(totalOwedToMe, currency)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 5. Participants Section */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold flex items-center gap-1.5">
              <span>Participants ({selectedParticipants.length})</span>
              <span className="text-[var(--error)]">*</span>
            </label>
            <span className="text-[11px] font-mono text-[var(--on-surface-variant)]">
              {selectedParticipants.length === 0
                ? 'Select people below'
                : `${selectedParticipants.length} people will owe you ${formatCurrency(totalOwedToMe, currency)}`}
            </span>
          </div>

          {/* Selected Participants List */}
          <div className="space-y-2 mb-3">
            {/* Payer Card (You) if included */}
            {includeSelf && (
              <div className="p-2.5 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/10 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={currentUser?.name || 'You'} src={currentUser?.avatar_url} size="sm" />
                  <div className="min-w-0">
                    <p className="font-semibold text-xs text-[var(--on-surface)] truncate">
                      {currentUser?.name || 'You'} <span className="font-normal text-[var(--on-surface-variant)]">(Organizer)</span>
                    </p>
                    <p className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                      Paid for the group • Share: {formatCurrency(myShare, currency)}
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                  Paid
                </span>
              </div>
            )}

            {/* Added Friends */}
            {participantShares.map((p) => (
              <div
                key={p.id}
                className="p-2.5 rounded-xl border border-[var(--outline-variant)]/25 bg-[var(--surface-container-low)] flex items-center justify-between gap-3 animate-in fade-in duration-150"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={p.name} src={p.avatar_url} size="sm" />
                  <div className="min-w-0">
                    <p className="font-semibold text-xs text-[var(--on-surface)] truncate">
                      {p.name}
                    </p>
                    <p className="font-mono text-[11px] text-[var(--on-surface-variant)] truncate">
                      {p.email || p.phone || 'Contact'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className="font-mono text-xs font-bold text-[var(--on-surface)] block">
                      {formatCurrency(p.shareAmount, currency)}
                    </span>
                    <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400 block">
                      Owes You
                    </span>
                    {interestType !== 'none' && (
                      <span className="font-mono text-[9px] text-[var(--primary)] font-bold block">
                        +{interestRate}% APR
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveParticipant(p.id)}
                    className="w-7 h-7 rounded-lg text-[var(--on-surface-variant)] hover:text-[var(--error)] hover:bg-[var(--surface-container)] flex items-center justify-center transition-colors cursor-pointer"
                    title="Remove from split"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Quick-Pick Frequent Contacts */}
          {quickPickContacts.length > 0 && !isAddingNewPerson && (
            <div className="mb-3">
              <span className="text-[11px] font-mono text-[var(--on-surface-variant)] block mb-1.5">
                Quick Add:
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {quickPickContacts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleToggleParticipant(c)}
                    className="px-2.5 py-1 rounded-full text-xs font-mono bg-[var(--surface-container-low)] hover:bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 text-[var(--on-surface)] transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px] text-[var(--primary)]">add</span>
                    <span className="truncate max-w-[120px]">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Add People Selector */}
          {!isAddingNewPerson ? (
            <div className="space-y-2">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-[16px] text-[var(--on-surface-variant)]">
                  search
                </span>
                <input
                  type="text"
                  placeholder="Search contacts by name, email, or phone..."
                  value={personSearch}
                  onChange={(e) => setPersonSearch(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-sm text-[var(--on-surface)] outline-none focus:border-[var(--primary)]"
                />
                {isSearchingPlatform && (
                  <span className="material-symbols-outlined absolute right-3 top-2.5 text-[16px] text-[var(--primary)] animate-spin">
                    progress_activity
                  </span>
                )}
              </div>

              {/* Matching Search Results Dropdown List */}
              {personSearch.trim().length > 0 && (
                <div className="max-h-48 overflow-y-auto overscroll-contain modal-scroll-container rounded-xl border border-[var(--outline-variant)]/20 p-1.5 bg-[var(--surface-container-low)] space-y-1">
                  {filteredContacts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleToggleParticipant(p)}
                      className="w-full text-left p-2 rounded-lg hover:bg-[var(--surface)] transition-colors flex items-center justify-between group cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={p.name} src={p.avatar_url} size="sm" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[var(--on-surface)] truncate">
                            {p.name}
                          </p>
                          <p className="text-[11px] text-[var(--on-surface-variant)] truncate">
                            {p.email || p.phone}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-[var(--primary)] font-bold shrink-0 ml-2">
                        + Add to Split
                      </span>
                    </button>
                  ))}

                  {platformSearchResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleToggleParticipant(p)}
                      className="w-full text-left p-2 rounded-lg hover:bg-[var(--surface)] transition-colors flex items-center justify-between group cursor-pointer border-t border-[var(--outline-variant)]/10"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={p.name} src={p.avatar_url} size="sm" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[var(--on-surface)] truncate">
                            {p.name} <span className="font-mono text-[10px] text-[var(--primary)]">(Platform User)</span>
                          </p>
                          <p className="text-[11px] text-[var(--on-surface-variant)] truncate">
                            {p.email || p.phone}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-[var(--primary)] font-bold shrink-0 ml-2">
                        + Add
                      </span>
                    </button>
                  ))}

                  {filteredContacts.length === 0 && platformSearchResults.length === 0 && !isSearchingPlatform && (
                    <div className="p-3 text-center text-xs font-mono text-[var(--on-surface-variant)]">
                      No matching contacts found.
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => setIsAddingNewPerson(true)}
                className="w-full py-2 px-3 rounded-xl border border-dashed border-[var(--outline-variant)]/60 text-[var(--primary)] hover:bg-[var(--primary)]/5 font-mono text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">person_add</span>
                <span>Add Someone New (Phone/Email)</span>
              </button>
            </div>
          ) : (
            /* Inline Add New Person Form */
            <div className="p-3.5 bg-[var(--surface-container-low)] rounded-xl border border-[var(--primary)]/30 space-y-3 animate-in fade-in duration-150">
              <div className="flex justify-between items-center">
                <span className="font-heading text-xs font-bold text-[var(--on-surface)] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">person_add</span>
                  <span>Add New Contact to Split</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddingNewPerson(false)}
                  className="text-xs font-mono text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[var(--on-surface-variant)] mb-1">
                  Full Name <span className="text-[var(--error)]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Alex Rivera"
                  value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[var(--on-surface-variant)] mb-1">
                  Phone Number <span className="text-[var(--error)]">* (Primary contact)</span>
                </label>
                <PhoneInput
                  value={newPersonPhone}
                  onChange={setNewPersonPhone}
                  defaultCountryCode={defaultCountryCode}
                  placeholder="Primary phone number"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[var(--on-surface-variant)] mb-1">
                  Email Address <span className="text-[var(--outline)]">(Optional)</span>
                </label>
                <input
                  type="email"
                  placeholder="alex@example.com (optional)"
                  value={newPersonEmail}
                  onChange={(e) => setNewPersonEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>

              <button
                type="button"
                onClick={handleAddNewPersonSubmit}
                disabled={loading}
                className="w-full py-2 px-3 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:brightness-110 transition-all cursor-pointer shadow-xs disabled:opacity-50"
              >
                Save &amp; Add to Split
              </button>
            </div>
          )}
        </div>

        {/* 6. Terms & Interest Rates */}
        <div className="p-4 rounded-xl border border-[var(--outline-variant)]/30 bg-[var(--surface-container-low)] space-y-3">
          <div className="flex items-center justify-between">
            <label className="font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">percent</span>
              <span>Terms &amp; Interest Rates</span>
            </label>
            <span className="text-[11px] font-mono text-[var(--on-surface-variant)]">
              {interestType === 'none' ? '0% Accrual (Interest-Free)' : `${interestRate}% ${interestType.toUpperCase()} APR`}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setInterestType('none')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                interestType === 'none'
                  ? 'border-[var(--primary)] bg-[var(--primary-container)]/15 ring-1 ring-[var(--primary)]'
                  : 'border-[var(--outline-variant)]/30 hover:border-[var(--outline-variant)] bg-[var(--surface)]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)] block mb-0.5">
                block
              </span>
              <div className="font-mono text-xs font-bold text-[var(--on-surface)]">NONE</div>
              <div className="text-[10px] text-[var(--on-surface-variant)] mt-0.5">0% Accrual</div>
            </button>

            <button
              type="button"
              onClick={() => {
                setInterestType('simple');
                if (interestRate === 0) {
                  setInterestRate(5);
                  setInterestRateStr('5.00');
                }
              }}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                interestType === 'simple'
                  ? 'border-[var(--primary)] bg-[var(--primary-container)]/15 ring-1 ring-[var(--primary)]'
                  : 'border-[var(--outline-variant)]/30 hover:border-[var(--outline-variant)] bg-[var(--surface)]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px] text-[var(--secondary)] block mb-0.5">
                trending_up
              </span>
              <div className="font-mono text-xs font-bold text-[var(--on-surface)]">SIMPLE</div>
              <div className="text-[10px] text-[var(--on-surface-variant)] mt-0.5">Linear APR</div>
            </button>

            <button
              type="button"
              onClick={() => {
                setInterestType('compound');
                if (interestRate === 0) {
                  setInterestRate(5);
                  setInterestRateStr('5.00');
                }
              }}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                interestType === 'compound'
                  ? 'border-[var(--primary)] bg-[var(--primary-container)]/15 ring-1 ring-[var(--primary)]'
                  : 'border-[var(--outline-variant)]/30 hover:border-[var(--outline-variant)] bg-[var(--surface)]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px] text-[var(--primary)] block mb-0.5">
                auto_graph
              </span>
              <div className="font-mono text-xs font-bold text-[var(--on-surface)]">COMPOUND</div>
              <div className="text-[10px] text-[var(--on-surface-variant)] mt-0.5">Exponential</div>
            </button>
          </div>

          {interestType !== 'none' && (
            <div className="pt-2 border-t border-[var(--outline-variant)]/20 space-y-3 animate-in fade-in duration-150">
              <div className="flex justify-between items-center">
                <div>
                  <span className="font-mono text-xs font-bold text-[var(--on-surface)] block">
                    Annual Percentage Rate (APR)
                  </span>
                  <span className="font-mono text-[10px] text-[var(--outline)]">
                    Applied equally to all co-participant shares
                  </span>
                </div>

                <div className="relative w-24">
                  <input
                    type="number"
                    min="0"
                    max="500"
                    step="0.01"
                    value={interestRateStr}
                    placeholder="0.00"
                    onChange={(e) => handleInterestRateChange(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-sm font-bold text-right pr-6 outline-none focus:border-[var(--primary)]"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-xs font-bold text-[var(--primary)] pointer-events-none">
                    %
                  </span>
                </div>
              </div>

              {/* APR Slider */}
              <div className="space-y-1">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.05"
                  value={Math.min(100, Math.max(0, interestRate))}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setInterestRate(val);
                    setInterestRateStr(val.toFixed(2));
                  }}
                  className="w-full accent-[var(--primary)] cursor-pointer"
                />
                <div className="flex justify-between font-mono text-[10px] text-[var(--outline)] px-0.5">
                  <span>0%</span>
                  <span>25%</span>
                  <span>50%</span>
                  <span>75%</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--outline)] mr-1">Presets:</span>
                {[5, 10, 15, 24, 36].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setInterestRate(preset);
                      setInterestRateStr(preset.toFixed(2));
                    }}
                    className={`px-2 py-0.5 rounded-md font-mono text-[10px] border transition-colors cursor-pointer ${
                      interestRate === preset
                        ? 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)] font-bold'
                        : 'border-[var(--outline-variant)]/40 hover:bg-[var(--surface-container)] text-[var(--on-surface-variant)]'
                    }`}
                  >
                    {preset}%
                  </button>
                ))}
              </div>

              {/* Compounding Frequency and Due Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {interestType === 'compound' && (
                  <div>
                    <label className="block font-mono text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold mb-1">
                      Compounding Frequency
                    </label>
                    <select
                      value={compoundFreq}
                      onChange={(e) => setCompoundFreq(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-xs font-mono outline-none focus:border-[var(--primary)]"
                    >
                      <option value="daily">Daily Compounding</option>
                      <option value="weekly">Weekly Compounding</option>
                      <option value="monthly">Monthly Compounding</option>
                      <option value="yearly">Yearly Compounding</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold mb-1">
                    Repayment Due Date (Optional)
                  </label>
                  <input
                    type="date"
                    min={transactionDate}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-xs font-mono outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              {/* Clarification info */}
              <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[15px] shrink-0">info</span>
                <span>
                  Each participant will be charged {interestRate}% {interestType} interest on their share until settled.
                </span>
              </p>
            </div>
          )}
        </div>

        {/* 7. Date & Optional Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label className="block font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold mb-1">
              Date of Expense
            </label>
            <input
              type="date"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-xs font-mono outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div>
            <label className="block font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold mb-1">
              Optional Note
            </label>
            <input
              type="text"
              placeholder="e.g. Paid via GPay, includes 5% tip"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-xs font-mono outline-none focus:border-[var(--primary)]"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--outline-variant)]/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 font-mono text-xs font-bold text-[var(--on-surface-variant)] hover:bg-[var(--surface-container)] transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={loading || selectedParticipants.length === 0 || totalAmount <= 0}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[var(--primary)] to-[var(--primary-container)] text-[var(--on-primary)] font-mono text-xs font-bold hover:brightness-110 active:scale-[0.98] transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                <span>Logging Split Requests...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">call_split</span>
                <span>
                  Split {formatCurrency(totalAmount, currency)} ({totalCount} People)
                  {interestType !== 'none' ? ` @ ${interestRate}% APR` : ''}
                </span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
