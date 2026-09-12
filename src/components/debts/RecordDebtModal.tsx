'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Contact, Profile } from '@/lib/types/database';
import { formatCurrency, SUPPORTED_CURRENCIES } from '@/lib/utils/currency';
import { projectDebtGrowth, round2 } from '@/lib/utils/interest';
import { findProfileByIdentifier } from '@/lib/utils/profile-lookup';
import { checkDebtRequestCooldown, type CooldownCheckResult } from '@/lib/utils/debt-cooldown';
import { PhoneInput } from '../ui/PhoneInput';

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
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonEmail, setNewPersonEmail] = useState('');
  const [newPersonPhone, setNewPersonPhone] = useState('');
  const [defaultCountryCode, setDefaultCountryCode] = useState('+91');
  const [isAddingNewPerson, setIsAddingNewPerson] = useState(false);

  // Anti-harassment cooldown states
  const [cooldown, setCooldown] = useState<CooldownCheckResult | null>(null);
  const [checkingCooldown, setCheckingCooldown] = useState(false);

  const [principal, setPrincipal] = useState<number>(1500);
  const [currency, setCurrency] = useState('inr');
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent'); // lent = current user is lender
  const [interestType, setInterestType] = useState<'none' | 'simple' | 'compound'>('simple');
  const [interestRate, setInterestRate] = useState<number>(5.0);
  const [compoundFreq, setCompoundFreq] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
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

  // Projected growth preview (12 months)
  const projection = projectDebtGrowth(
    Number(principal) || 0,
    interestType,
    interestType === 'none' ? 0 : Number(interestRate) || 0,
    compoundFreq,
    12
  );
  const finalProjection = projection[projection.length - 1] || { total: principal, interest: 0 };

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
        if (!newPersonEmail.trim() && !newPersonPhone.trim()) {
          throw new Error('Please provide an email or phone number for the other party');
        }

        const targetEmail = newPersonEmail.trim().toLowerCase();
        const targetPhone = newPersonPhone.trim();

        // Check if profile exists across primary email, secondary emails, or phone
        const existingProfile = targetEmail
          ? await findProfileByIdentifier(targetEmail)
          : (targetPhone ? await findProfileByIdentifier(targetPhone) : null);

        if (existingProfile) {
          targetUserId = existingProfile.id;
        } else {
          // Create shadow profile
          const shadowId = crypto.randomUUID();
          const fallbackEmail = targetEmail || `${targetPhone.replace(/[^\d]/g, '')}@phone.debtsync.local`;
          const { error: shadowError } = await supabase.from('profiles').insert({
            id: shadowId,
            email: fallbackEmail,
            full_name: newPersonName.trim() || (targetEmail ? targetEmail.split('@')[0] : targetPhone),
            phone: targetPhone || null,
            is_shadow: true,
          });
          if (shadowError) throw shadowError;
          targetUserId = shadowId;
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

  const filteredPeople = people.filter((p) => {
    if (!personSearch.trim()) return true;
    const q = personSearch.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q) ||
      (p.phone && p.phone.includes(q))
    );
  });

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
                  Select Person
                </label>
                <button
                  type="button"
                  onClick={() => setIsAddingNewPerson(!isAddingNewPerson)}
                  className="text-xs text-[var(--primary)] font-bold hover:underline"
                >
                  {isAddingNewPerson ? 'Select Existing' : '+ New Person'}
                </button>
              </div>

              {!isAddingNewPerson ? (
                <div className="space-y-2">
                  {people.length > 3 && (
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-2.5 text-[16px] text-[var(--on-surface-variant)]">
                        search
                      </span>
                      <input
                        type="text"
                        placeholder="Search contact name, email, or phone..."
                        value={personSearch}
                        onChange={(e) => setPersonSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[var(--outline-variant)]/30 bg-[var(--surface-container-lowest)] text-xs text-[var(--on-surface)] outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                  )}

                  <select
                    value={selectedPersonId || preselectedContactId || (filteredPeople[0]?.id ?? '')}
                    onChange={(e) => setSelectedPersonId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/10 outline-none text-sm font-medium"
                  >
                    {filteredPeople.length === 0 && (
                      <option value="">No contacts match your search</option>
                    )}
                    {filteredPeople.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.email ? `(${p.email})` : p.phone ? `(${p.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-2.5 p-3 bg-[var(--surface)] rounded-xl border border-[var(--outline-variant)]/30">
                  <input
                    type="text"
                    placeholder="Full Name (e.g. Sarah Jenkins)"
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface-container-lowest)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
                  />
                  <input
                    type="email"
                    placeholder="Email Address (e.g. sarah@example.com)"
                    value={newPersonEmail}
                    onChange={(e) => setNewPersonEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface-container-lowest)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
                  />
                  <PhoneInput
                    value={newPersonPhone}
                    onChange={setNewPersonPhone}
                    defaultCountryCode={defaultCountryCode}
                    placeholder="Phone Number (optional)"
                  />
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
                    value={principal}
                    onChange={(e) => setPrincipal(Number(e.target.value))}
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
                          step="0.1"
                          value={interestRate === 0 ? '' : interestRate}
                          placeholder="0.0"
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (isNaN(val) || val < 0) {
                              setInterestRate(0);
                            } else {
                              setInterestRate(Math.min(500, Math.round((val + Number.EPSILON) * 100) / 100));
                            }
                          }}
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
                        step="0.5"
                        value={Math.min(100, Math.max(0, interestRate))}
                        onChange={(e) => setInterestRate(Number(e.target.value))}
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
                          onClick={() => setInterestRate(preset)}
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
