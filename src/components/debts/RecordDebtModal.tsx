'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Contact, Profile } from '@/lib/types/database';
import { formatCurrency, SUPPORTED_CURRENCIES } from '@/lib/utils/currency';
import { projectDebtGrowth, round2, calculateDebtBalance } from '@/lib/utils/interest';
import { findProfileByIdentifier, searchProfiles } from '@/lib/utils/profile-lookup';
import { checkDebtRequestCooldown, type CooldownCheckResult } from '@/lib/utils/debt-cooldown';
import { sendNotificationEmail } from '@/lib/utils/email-notifier';
import { PhoneInput } from '../ui/PhoneInput';
import { Avatar } from '../ui/Avatar';

interface RecordDebtModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDebtCreated?: () => void;
  preselectedContactId?: string;
}

interface PersonOption {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  avatar_url?: string | null;
  isPlatformUser?: boolean;
}

export function RecordDebtModal({
  isOpen,
  onClose,
  onDebtCreated,
  preselectedContactId,
}: RecordDebtModalProps) {
  const supabase = createClient();

  // Form states
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState(preselectedContactId || '');
  const [personSearch, setPersonSearch] = useState('');
  const [platformSearchResults, setPlatformSearchResults] = useState<PersonOption[]>([]);
  const [isSearchingPlatform, setIsSearchingPlatform] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonEmail, setNewPersonEmail] = useState('');
  const [newPersonPhone, setNewPersonPhone] = useState('');
  const [defaultCountryCode, setDefaultCountryCode] = useState('+91');
  const [isAddingNewPerson, setIsAddingNewPerson] = useState(false);

  // Anti-harassment cooldown states
  const [cooldown, setCooldown] = useState<CooldownCheckResult | null>(null);
  const [checkingCooldown, setCheckingCooldown] = useState(false);

  // Numeric states backed by clean strings to avoid leading zero bugs and support 2 decimal places
  const [principalStr, setPrincipalStr] = useState<string>('1500');
  const [principal, setPrincipal] = useState<number>(1500);
  const [currency, setCurrency] = useState('inr');
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent'); // lent = current user is lender
  const [interestType, setInterestType] = useState<'none' | 'simple' | 'compound'>('simple');
  const [interestRateStr, setInterestRateStr] = useState<string>('5.00');
  const [interestRate, setInterestRate] = useState<number>(5.0);
  const [compoundFreq, setCompoundFreq] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [transactionDate, setTransactionDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Keep selectedPersonId synchronized when preselectedContactId or isOpen changes
  useEffect(() => {
    if (preselectedContactId) {
      setSelectedPersonId(preselectedContactId);
      setIsAddingNewPerson(false);
    }
  }, [preselectedContactId, isOpen]);

  // Verify anti-harassment cooldown when selected contact changes
  useEffect(() => {
    async function verifyCooldown() {
      const targetId = selectedPersonId || preselectedContactId;
      if (!targetId || isAddingNewPerson) {
        setCooldown(null);
        return;
      }
      setCheckingCooldown(true);
      try {
        const res = await checkDebtRequestCooldown(supabase, targetId);
        setCooldown(res);
      } catch (err) {
        console.error('Failed to verify debt request cooldown:', err);
      } finally {
        setCheckingCooldown(false);
      }
    }

    if (isOpen) {
      verifyCooldown();
    }
  }, [selectedPersonId, preselectedContactId, isAddingNewPerson, isOpen, supabase]);

  // Load contacts and counterparties
  useEffect(() => {
    async function loadContacts() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const peopleMap = new Map<string, PersonOption>();

      // 1. Fetch from contacts table
      const { data: contactData } = await supabase
        .from('contacts')
        .select(`
          contact_id, nickname,
          profile:profiles!contacts_contact_id_fkey(id, email, full_name, phone)
        `)
        .eq('owner_id', user.id);

      if (contactData) {
        for (const c of contactData as any[]) {
          if (c.profile) {
            peopleMap.set(c.contact_id, {
              id: c.contact_id,
              name: c.nickname || c.profile.full_name || c.profile.email,
              email: c.profile.email,
              phone: c.profile.phone,
            });
          }
        }
      }

      // 2. Fetch counterparties from existing debts (excluding declined debts to respect privacy)
      const { data: debtData } = await supabase
        .from('debts')
        .select(`
          status,
          lender_id, borrower_id,
          lender:profiles!debts_lender_id_fkey(id, email, full_name, phone),
          borrower:profiles!debts_borrower_id_fkey(id, email, full_name, phone)
        `)
        .or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`)
        .neq('status', 'declined');

      if (debtData) {
        for (const d of debtData as any[]) {
          const isLender = d.lender_id === user.id;
          const otherParty = isLender ? d.borrower : d.lender;
          if (otherParty && !peopleMap.has(otherParty.id)) {
            peopleMap.set(otherParty.id, {
              id: otherParty.id,
              name: otherParty.full_name || otherParty.email,
              email: otherParty.email,
              phone: otherParty.phone,
            });
          }
        }
      }

      // 3. If preselectedContactId was passed, ensure their profile is fetched if not yet present
      if (preselectedContactId && !peopleMap.has(preselectedContactId)) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, email, full_name, phone')
          .eq('id', preselectedContactId)
          .single();

        if (profile) {
          peopleMap.set(profile.id, {
            id: profile.id,
            name: profile.full_name || profile.email,
            email: profile.email,
            phone: profile.phone,
          });
        }
      }

      const peopleList = Array.from(peopleMap.values());
      setPeople(peopleList);

      if (preselectedContactId) {
        setSelectedPersonId(preselectedContactId);
      } else if (!selectedPersonId && peopleList.length > 0) {
        setSelectedPersonId(peopleList[0].id);
      }
    }

    if (isOpen) {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('debtsync_default_country_code');
        if (saved) setDefaultCountryCode(saved);
      }
      loadContacts();
    }
  }, [isOpen, preselectedContactId, supabase]);

  // Live platform profile search with debouncing
  useEffect(() => {
    const term = personSearch.trim();
    if (term.length < 2) {
      setPlatformSearchResults([]);
      setIsSearchingPlatform(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingPlatform(true);
      try {
        const found = await searchProfiles(term, 5);
        const newResults: PersonOption[] = [];
        for (const p of found) {
          if (!people.some((existing) => existing.id === p.id)) {
            newResults.push({
              id: p.id,
              name: p.full_name || p.email,
              email: p.email,
              phone: p.phone,
              avatar_url: p.avatar_url,
              isPlatformUser: true,
            });
          }
        }
        setPlatformSearchResults(newResults);

        // Auto-select if an exact email or exact phone matches an existing account
        const cleanTerm = term.toLowerCase();
        const cleanDigits = term.replace(/[^\d]/g, '');
        const exactMatch =
          people.find(
            (p) =>
              (p.email && p.email.toLowerCase() === cleanTerm) ||
              (p.phone && cleanDigits.length >= 10 && p.phone.replace(/[^\d]/g, '').slice(-10) === cleanDigits.slice(-10))
          ) ||
          newResults.find(
            (p) =>
              (p.email && p.email.toLowerCase() === cleanTerm) ||
              (p.phone && cleanDigits.length >= 10 && p.phone.replace(/[^\d]/g, '').slice(-10) === cleanDigits.slice(-10))
          );

        if (exactMatch && !selectedPersonId) {
          setSelectedPersonId(exactMatch.id);
          setIsAddingNewPerson(false);
        }
      } catch (err) {
        console.error('Failed to search platform profiles:', err);
      } finally {
        setIsSearchingPlatform(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [personSearch, people, selectedPersonId]);

  // Handlers to eliminate leading-zero typing glitches
  const handlePrincipalChange = (val: string) => {
    // Strip leading zeros if followed by another digit, e.g. "05" -> "5"
    const sanitized = val.replace(/^0+(?=\d)/, '');
    setPrincipalStr(sanitized);
    setPrincipal(parseFloat(sanitized) || 0);
  };

  const handleInterestRateChange = (val: string) => {
    const sanitized = val.replace(/^0+(?=\d)/, '');
    setInterestRateStr(sanitized);
    const num = parseFloat(sanitized);
    if (isNaN(num) || num < 0) {
      setInterestRate(0);
    } else {
      setInterestRate(Math.min(500, Math.round((num + Number.EPSILON) * 100) / 100));
    }
  };

  const filteredPeople = people.filter((p) => {
    if (!personSearch.trim()) return true;
    const s = personSearch.toLowerCase();
    return (
      p.name?.toLowerCase().includes(s) ||
      p.email?.toLowerCase().includes(s) ||
      p.phone?.includes(s)
    );
  });

  const selectedPerson =
    people.find((p) => p.id === (selectedPersonId || preselectedContactId)) ||
    platformSearchResults.find((p) => p.id === (selectedPersonId || preselectedContactId));

  // Projected growth preview (12 months)
  const projection = projectDebtGrowth(
    Number(principal) || 0,
    interestType,
    interestType === 'none' ? 0 : Number(interestRate) || 0,
    compoundFreq,
    12
  );
  const finalProjection = projection[projection.length - 1] || { total: principal, interest: 0 };

  // Calculate elapsed days & backdated accrued interest from origination date to today
  const now = new Date();
  const originationDate = transactionDate ? new Date(transactionDate + 'T12:00:00Z') : now;
  const daysElapsed = Math.max(
    0,
    Math.floor((now.getTime() - originationDate.getTime()) / (1000 * 60 * 60 * 24))
  );

  const backdatedDebtMock: any = {
    principal: round2(Number(principal) || 0),
    currency,
    interest_type: interestType,
    interest_rate: interestType === 'none' ? null : round2(Number(interestRate)),
    compound_freq: interestType === 'compound' ? compoundFreq : null,
    status: 'active',
    created_at: originationDate.toISOString(),
  };
  const backdatedCalc = calculateDebtBalance(backdatedDebtMock, [], now);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not logged in');

      let targetUserId = selectedPersonId || preselectedContactId || '';

      // If user wants to add a new person inline
      if (isAddingNewPerson) {
        const cleanPhone = newPersonPhone.trim();
        const phoneDigits = cleanPhone.replace(/[^\d]/g, '');
        if (!cleanPhone || phoneDigits.length < 7) {
          throw new Error('Primary phone number is compulsory when creating a new counterparty.');
        }

        const targetEmail = newPersonEmail.trim().toLowerCase();
        const targetPhone = cleanPhone;

        // Check if profile exists across primary email, secondary emails, or phone
        const existingProfile = targetEmail
          ? await findProfileByIdentifier(targetEmail)
          : await findProfileByIdentifier(targetPhone);

        if (existingProfile) {
          targetUserId = existingProfile.id;
        } else {
          // Create ghost / shadow profile
          const shadowId = crypto.randomUUID();
          const fallbackEmail = targetEmail || `${targetPhone.replace(/[^\d]/g, '')}@phone.debtsync.local`;
          const finalName = newPersonName.trim() || (targetEmail ? targetEmail.split('@')[0] : targetPhone);
          const { error: shadowError } = await supabase.from('profiles').insert({
            id: shadowId,
            email: fallbackEmail,
            full_name: finalName,
            phone: targetPhone || null,
            is_shadow: true,
          });
          if (shadowError) throw shadowError;
          targetUserId = shadowId;

          // Dispatch rate-limited invitation email if an actual email was provided
          if (targetEmail && !targetEmail.endsWith('@phone.debtsync.local')) {
            sendNotificationEmail({
              type: 'ghost_account_invite',
              recipientEmail: targetEmail,
              recipientName: finalName,
              senderName: user.user_metadata?.full_name || user.email || 'A DebtSync user',
              amount: round2(Number(principal)),
              currency,
              notes: notes.trim() || undefined,
            });
          }
        }
      } else if (!targetUserId && people.length > 0) {
        targetUserId = people[0].id;
      }

      if (!targetUserId) {
        throw new Error('Please select or add a person');
      }

      // Check anti-harassment cooldown before submitting
      const cooldownCheck = await checkDebtRequestCooldown(supabase, targetUserId);
      if (!cooldownCheck.allowed) {
        throw new Error(
          cooldownCheck.message ||
          `Request cooldown active: This contact previously declined your requests. Please wait ${cooldownCheck.cooldownRemainingFormatted || 'the cooldown period'} before sending another request.`
        );
      }

      const lenderId = direction === 'lent' ? user.id : targetUserId;
      const borrowerId = direction === 'lent' ? targetUserId : user.id;

      // Create debt
      const { data: debt, error: debtError } = await supabase
        .from('debts')
        .insert({
          created_by: user.id,
          lender_id: lenderId,
          borrower_id: borrowerId,
          principal: round2(Number(principal)),
          currency,
          interest_type: interestType,
          interest_rate: interestType === 'none' ? null : round2(Number(interestRate)),
          compound_freq: interestType === 'compound' ? compoundFreq : null,
          status: 'pending', // pending approval from other party
          due_date: dueDate ? new Date(dueDate).toISOString() : null,
          created_at: originationDate.toISOString(),
          notes: notes.trim() || null,
        })
        .select()
        .single();

      if (debtError) throw debtError;

      // Privacy: We do NOT insert into contacts here!
      // Contacts are only created mutually upon explicit acceptance by the counterparty.

      // Create activity log
      await supabase.from('activity_log').insert({
        user_id: user.id,
        debt_id: debt.id,
        action: 'debt_created',
        details: {
          principal,
          currency,
          direction,
          interest_type: interestType,
          interest_rate: interestRate,
        },
      });
      // Send debt_recorded email notification to existing counterparty if they have an email
      if (!isAddingNewPerson && targetUserId) {
        const targetPerson = people.find((p) => p.id === targetUserId);
        if (targetPerson?.email && !targetPerson.email.endsWith('@phone.debtsync.local')) {
          sendNotificationEmail({
            type: 'debt_recorded',
            recipientEmail: targetPerson.email,
            recipientName: targetPerson.name,
            senderName: user.user_metadata?.full_name || user.email || 'A DebtSync user',
            amount: round2(Number(principal)),
            currency,
            notes: notes.trim() || undefined,
            debtId: debt.id,
          });
        }
      }

      setNewPersonName('');
      setNewPersonEmail('');
      setNewPersonPhone('');
      setDueDate('');
      setIsAddingNewPerson(false);
      onDebtCreated?.();
      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record debt');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record New Debt"
      subtitle="Create a transparent record for a new transaction"
      maxWidth="max-w-3xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-[var(--error)] text-sm border border-[var(--error)]/20">
            {error}
          </div>
        )}

        {cooldown && !cooldown.allowed && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 space-y-1">
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider">
              <span className="material-symbols-outlined text-[18px]">lock_clock</span>
              <span>Anti-Harassment Cooldown Active</span>
            </div>
            <p className="text-xs leading-relaxed">
              This contact declined your previous {cooldown.declinedCount} request{cooldown.declinedCount > 1 ? 's' : ''}.
              To protect privacy and prevent spam, new requests to this contact are paused for another{' '}
              <span className="font-bold font-mono underline">{cooldown.cooldownRemainingFormatted || 'cooldown period'}</span>.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Inputs Column */}
          <div className="lg:col-span-7 space-y-5">
            {/* Select / Add Person */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)]">
                  Counterparty
                </label>
                {!isAddingNewPerson ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingNewPerson(true);
                      setSelectedPersonId('');
                      if (personSearch.includes('@')) {
                        setNewPersonEmail(personSearch);
                      } else if (/^\+?\d+$/.test(personSearch.trim())) {
                        setNewPersonPhone(personSearch);
                      } else if (personSearch.trim()) {
                        setNewPersonName(personSearch);
                      }
                    }}
                    className="text-xs text-[var(--primary)] font-bold hover:underline flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">person_add</span>
                    <span>+ New Person (Ghost)</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsAddingNewPerson(false)}
                    className="text-xs text-[var(--primary)] font-bold hover:underline flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                    <span>Select Existing</span>
                  </button>
                )}
              </div>

              {isAddingNewPerson ? (
                <div className="space-y-3 p-3.5 bg-[var(--surface-container-low)] rounded-xl border border-[var(--outline-variant)]/30">
                  <div className="flex items-center gap-2 text-xs font-mono text-[var(--on-surface-variant)] pb-1 border-b border-[var(--outline-variant)]/15">
                    <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">person_pin</span>
                    <span className="font-bold uppercase tracking-wider">New Person / Ghost Account</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-[var(--on-surface-variant)] mb-1">
                      Full Name <span className="text-[var(--error)]">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Sarah Jenkins"
                      value={newPersonName}
                      onChange={(e) => setNewPersonName(e.target.value)}
                      required
                      className="w-full px-3 py-2 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-[var(--on-surface-variant)] mb-1">
                      Email Address <span className="text-[var(--outline)]">(Optional - invites them if known)</span>
                    </label>
                    <input
                      type="email"
                      placeholder="e.g. sarah@example.com (leave blank if unknown)"
                      value={newPersonEmail}
                      onChange={(e) => setNewPersonEmail(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-[var(--on-surface-variant)] mb-1">
                      Phone Number <span className="text-[var(--error)]">* (Compulsory primary contact)</span>
                    </label>
                    <PhoneInput
                      value={newPersonPhone}
                      onChange={setNewPersonPhone}
                      defaultCountryCode={defaultCountryCode}
                      placeholder="Primary phone number"
                      required
                    />
                  </div>

                  <p className="text-[11px] text-[var(--on-surface-variant)]/80 leading-relaxed bg-[var(--surface)] p-2 rounded-lg border border-[var(--outline-variant)]/20">
                    <span className="font-bold text-[var(--on-surface)]">Note:</span> If email is unknown, we will track this person by their phone number. A claimable ghost account will be created.
                  </p>
                </div>
              ) : selectedPerson ? (
                <div className="p-3 bg-[var(--surface-container-low)] rounded-xl border border-[var(--primary)]/30 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={selectedPerson.name} src={selectedPerson.avatar_url} size="md" />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-[var(--on-surface)] flex items-center gap-1.5 truncate">
                        <span className="truncate">{selectedPerson.name}</span>
                        {selectedPerson.isPlatformUser && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--primary)]/15 text-[var(--primary)] shrink-0">
                            Registered
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--on-surface-variant)] truncate">
                        {selectedPerson.email || selectedPerson.phone || 'Contact'}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPersonId('');
                      setPersonSearch('');
                    }}
                    className="px-2.5 py-1 text-xs font-mono font-semibold rounded-lg bg-[var(--surface)] text-[var(--primary)] border border-[var(--outline-variant)]/30 hover:bg-[var(--surface-container-high)] shrink-0 ml-2"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-2.5 text-[16px] text-[var(--on-surface-variant)]">
                      search
                    </span>
                    <input
                      type="text"
                      placeholder="Search by name, email, or phone..."
                      value={personSearch}
                      onChange={(e) => setPersonSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-sm text-[var(--on-surface)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30"
                      autoFocus
                    />
                    {isSearchingPlatform && (
                      <span className="material-symbols-outlined absolute right-3 top-2.5 text-[16px] text-[var(--primary)] animate-spin">
                        progress_activity
                      </span>
                    )}
                  </div>

                  {/* List of matching contacts and platform users */}
                  <div className="max-h-48 overflow-y-auto space-y-1 rounded-xl border border-[var(--outline-variant)]/20 p-1.5 bg-[var(--surface-container-low)]">
                    {filteredPeople.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedPersonId(p.id);
                          setPersonSearch('');
                        }}
                        className="w-full text-left p-2 rounded-lg hover:bg-[var(--surface)] transition-colors flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar name={p.name} src={p.avatar_url} size="sm" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[var(--on-surface)] truncate">
                              {p.name}
                            </div>
                            <div className="text-[11px] text-[var(--on-surface-variant)] truncate">
                              {p.email || p.phone}
                            </div>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono text-[var(--outline)] group-hover:text-[var(--primary)]">
                          Select
                        </span>
                      </button>
                    ))}

                    {platformSearchResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setPeople((prev) => [...prev, p]);
                          setSelectedPersonId(p.id);
                          setPersonSearch('');
                        }}
                        className="w-full text-left p-2 rounded-lg hover:bg-[var(--surface)] transition-colors flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar name={p.name} src={p.avatar_url} size="sm" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[var(--on-surface)] flex items-center gap-1 truncate">
                              <span className="truncate">{p.name}</span>
                              <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-[var(--primary)]/10 text-[var(--primary)]">
                                DebtSync
                              </span>
                            </div>
                            <div className="text-[11px] text-[var(--on-surface-variant)] truncate">
                              {p.email || p.phone}
                            </div>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono text-[var(--primary)]">
                          Connect
                        </span>
                      </button>
                    ))}

                    {filteredPeople.length === 0 && platformSearchResults.length === 0 && (
                      <div className="p-3 text-center space-y-2">
                        <p className="text-xs text-[var(--on-surface-variant)]">
                          {personSearch.trim().length >= 2
                            ? `No account found for "${personSearch}".`
                            : 'No contacts found.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingNewPerson(true);
                            if (personSearch.includes('@')) {
                              setNewPersonEmail(personSearch);
                            } else if (/^\+?\d+$/.test(personSearch.trim())) {
                              setNewPersonPhone(personSearch);
                            } else if (personSearch.trim()) {
                              setNewPersonName(personSearch);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] text-xs font-mono font-bold hover:brightness-110 shadow-xs"
                        >
                          <span className="material-symbols-outlined text-[14px]">person_add</span>
                          <span>Create Ghost Account</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Principal Amount & Currency */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
                  Principal Amount
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={principalStr}
                    placeholder="0.00"
                    onChange={(e) => handlePrincipalChange(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-lg font-bold outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <div>
                <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
                  Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-sm uppercase outline-none focus:border-[var(--primary)]"
                >
                  {SUPPORTED_CURRENCIES.map((curr) => (
                    <option key={curr.code} value={curr.code}>
                      {curr.code.toUpperCase()} ({curr.symbol})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Direction Toggle */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-[var(--surface-container)] rounded-xl">
              <button
                type="button"
                onClick={() => setDirection('lent')}
                className={`py-2 px-3 rounded-lg font-mono text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  direction === 'lent'
                    ? 'bg-[var(--surface-container-lowest)] text-[var(--secondary)] shadow-sm'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                <span>I Lent Money</span>
              </button>

              <button
                type="button"
                onClick={() => setDirection('borrowed')}
                className={`py-2 px-3 rounded-lg font-mono text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  direction === 'borrowed'
                    ? 'bg-[var(--surface-container-lowest)] text-[var(--error)] shadow-sm'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                <span>I Borrowed</span>
              </button>
            </div>

            {/* Interest Model */}
            <div>
              <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-2">
                Terms & Interest
              </label>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setInterestType('none')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    interestType === 'none'
                      ? 'border-[var(--primary)] bg-[var(--primary-container)]/10 ring-1 ring-[var(--primary)]'
                      : 'border-[var(--outline-variant)]/30 hover:border-[var(--outline-variant)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)] block mb-1">
                    block
                  </span>
                  <div className="font-mono text-xs font-bold text-[var(--on-surface)]">NONE</div>
                  <div className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">0% Accrual</div>
                </button>

                <button
                  type="button"
                  onClick={() => setInterestType('simple')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    interestType === 'simple'
                      ? 'border-[var(--primary)] bg-[var(--primary-container)]/10 ring-1 ring-[var(--primary)]'
                      : 'border-[var(--outline-variant)]/30 hover:border-[var(--outline-variant)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px] text-[var(--secondary)] block mb-1">
                    trending_up
                  </span>
                  <div className="font-mono text-xs font-bold text-[var(--on-surface)]">SIMPLE</div>
                  <div className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">On Principal</div>
                </button>

                <button
                  type="button"
                  onClick={() => setInterestType('compound')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    interestType === 'compound'
                      ? 'border-[var(--primary)] bg-[var(--primary-container)]/10 ring-1 ring-[var(--primary)]'
                      : 'border-[var(--outline-variant)]/30 hover:border-[var(--outline-variant)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px] text-[var(--primary)] block mb-1">
                    auto_graph
                  </span>
                  <div className="font-mono text-xs font-bold text-[var(--on-surface)]">COMPOUND</div>
                  <div className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">Exponential</div>
                </button>
              </div>

              {interestType !== 'none' && (
                <div className="p-4 bg-[var(--surface-container-low)] rounded-xl border border-[var(--outline-variant)]/20 space-y-4">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <span className="font-mono text-xs font-bold text-[var(--on-surface-variant)] block">
                          Annual Percentage Rate (APR)
                        </span>
                        <span className="font-mono text-[11px] text-[var(--outline)]">
                          Slide or type directly
                        </span>
                      </div>
                      <div className="relative w-28">
                        <input
                          type="number"
                          min="0"
                          max="500"
                          step="0.01"
                          value={interestRateStr}
                          placeholder="0.00"
                          onChange={(e) => handleInterestRateChange(e.target.value)}
                          onFocus={(e) => e.target.select()}
                          className="w-full px-3 py-1.5 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-sm font-bold text-right pr-7 outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-xs font-bold text-[var(--primary)] pointer-events-none">
                          %
                        </span>
                      </div>
                    </div>

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

                    {/* Quick APR Presets */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--outline)] mr-1">Presets:</span>
                      {[5, 10, 15, 24, 36, 50, 100].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setInterestRate(preset);
                            setInterestRateStr(preset.toFixed(2));
                          }}
                          className={`px-2 py-0.5 rounded-md font-mono text-xs transition-all cursor-pointer ${
                            interestRate === preset
                              ? 'bg-[var(--primary)] text-[var(--on-primary)] font-bold shadow-xs'
                              : 'bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]'
                          }`}
                        >
                          {preset}%
                        </button>
                      ))}
                    </div>

                    <div className="text-[11px] font-mono text-[var(--on-surface-variant)]/80 flex items-center gap-1.5 pt-2 border-t border-[var(--outline-variant)]/15 mt-2">
                      <span className="material-symbols-outlined text-[14px] text-[var(--primary)]">info</span>
                      <span>Interest accumulates in full 2-decimal currency units (&ge; 0.01).</span>
                    </div>
                  </div>

                  {interestType === 'compound' && (
                    <div>
                      <label className="font-mono text-xs text-[var(--on-surface-variant)] block mb-1">
                        Compounding Frequency
                      </label>
                      <select
                        value={compoundFreq}
                        onChange={(e) => setCompoundFreq(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Origination / Transaction Date (Supports Backdating) */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block font-semibold">
                  Origination / Transaction Date
                </label>
                {daysElapsed > 0 && (
                  <span className="font-mono text-[10px] font-bold text-[var(--secondary)] px-2 py-0.5 rounded-md bg-[var(--secondary)]/10 border border-[var(--secondary)]/20">
                    Backdated: {daysElapsed} day{daysElapsed > 1 ? 's' : ''} ago
                  </span>
                )}
              </div>
              <input
                type="date"
                value={transactionDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setTransactionDate(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)] font-mono"
              />
              <p className="text-[11px] font-mono text-[var(--on-surface-variant)] mt-1">
                {daysElapsed > 0
                  ? `Interest will automatically calculate for the ${daysElapsed} elapsed day(s) since this transaction occurred.`
                  : 'Lending or borrowing today. Interest starts accruing from today.'}
              </p>
            </div>

            {/* Expected Due Date */}
            <div>
              <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
                Expected Repayment Date <span className="normal-case text-[var(--outline)]">(optional)</span>
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)] font-mono"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
                Notes & Terms (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. Semester fee advance, split cab bills, dining"
                className="w-full px-3.5 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          {/* Right Projection Preview Column */}
          <div className="lg:col-span-5 flex flex-col justify-between p-5 bg-[var(--surface-container-low)] rounded-2xl border border-[var(--outline-variant)]/20">
            <div>
              <div className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] mb-1">
                Projected Growth (12 Mo)
              </div>
              <div className="font-numeric-ticker text-2xl font-bold text-[var(--primary)] mt-1">
                {formatCurrency(finalProjection.total, currency, { showDecimals: true })}
              </div>

              {/* Backdated Accrual Callout */}
              {daysElapsed > 0 && (
                <div className="my-3 p-3.5 rounded-xl bg-[var(--surface-container-high)]/90 border border-[var(--secondary)]/30 space-y-2">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-[var(--on-surface-variant)]">Backdated Elapsed:</span>
                    <span className="font-bold text-[var(--secondary)]">{daysElapsed} day{daysElapsed > 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-[var(--on-surface-variant)]">Already Accrued Interest:</span>
                    <span className="font-bold text-[var(--on-surface)]">
                      {formatCurrency(backdatedCalc.totalAccruedInterest, currency, { showDecimals: true })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs font-mono pt-1.5 border-t border-[var(--outline-variant)]/20">
                    <span className="font-bold text-[var(--on-surface)]">Current Effective Balance:</span>
                    <span className="font-bold font-numeric-ticker text-sm text-[var(--primary)]">
                      {formatCurrency(backdatedCalc.currentBalance, currency, { showDecimals: true })}
                    </span>
                  </div>
                </div>
              )}

              {/* Mini Sparkline Chart Preview */}
              <div className="h-28 w-full my-4 flex items-end gap-1.5 pt-4 pb-1 border-b border-[var(--outline-variant)]/20">
                {projection.map((pt, idx) => {
                  const maxVal = finalProjection.total || 1;
                  const heightPercent = Math.max(15, (pt.total / maxVal) * 100);
                  return (
                    <div
                      key={idx}
                      className="flex-1 bg-[var(--primary)]/70 hover:bg-[var(--primary)] rounded-t transition-all relative group"
                      style={{ height: `${heightPercent}%` }}
                      title={`Month ${pt.month}: ${formatCurrency(pt.total, currency)}`}
                    />
                  );
                })}
              </div>

              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between text-[var(--on-surface-variant)]">
                  <span>Principal</span>
                  <span className="font-bold text-[var(--on-surface)]">
                    {formatCurrency(principal, currency)}
                  </span>
                </div>
                <div className="flex justify-between text-[var(--on-surface-variant)]">
                  <span>Accrued Interest</span>
                  <span className="font-bold text-[var(--secondary)]">
                    +{formatCurrency(finalProjection.interest, currency, { showDecimals: true })}
                  </span>
                </div>
                <div className="flex justify-between text-[var(--on-surface-variant)] pt-2 border-t border-[var(--outline-variant)]/20">
                  <span>Payoff In</span>
                  <span className="font-bold text-[var(--on-surface)]">12 Months</span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-[var(--outline-variant)]/20">
              <button
                type="submit"
                disabled={loading || checkingCooldown || Boolean(cooldown && !cooldown.allowed)}
                className="w-full py-3 px-4 bg-[var(--primary)] text-[var(--on-primary)] rounded-xl font-bold font-mono text-sm hover:opacity-95 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {cooldown && !cooldown.allowed ? 'lock' : 'send'}
                </span>
                <span>
                  {loading
                    ? 'Creating...'
                    : checkingCooldown
                    ? 'Checking...'
                    : cooldown && !cooldown.allowed
                    ? 'Cooldown Active'
                    : 'Send Request'}
                </span>
              </button>
              <p className="text-[11px] text-[var(--on-surface-variant)] text-center mt-2">
                The other party will be notified to verify and accept these terms.
              </p>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
