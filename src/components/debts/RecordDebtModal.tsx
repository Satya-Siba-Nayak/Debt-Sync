'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Contact, Profile } from '@/lib/types/database';
import { formatCurrency, SUPPORTED_CURRENCIES } from '@/lib/utils/currency';
import { projectDebtGrowth } from '@/lib/utils/interest';

interface RecordDebtModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDebtCreated?: () => void;
  preselectedContactId?: string;
}

export function RecordDebtModal({
  isOpen,
  onClose,
  onDebtCreated,
  preselectedContactId,
}: RecordDebtModalProps) {
  const supabase = createClient();

  // Form states
  const [contacts, setContacts] = useState<(Contact & { profile?: Profile })[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState(preselectedContactId || '');
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonEmail, setNewPersonEmail] = useState('');
  const [isAddingNewPerson, setIsAddingNewPerson] = useState(false);

  const [principal, setPrincipal] = useState<number>(1500);
  const [currency, setCurrency] = useState('inr');
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent'); // lent = current user is lender
  const [interestType, setInterestType] = useState<'none' | 'simple' | 'compound'>('simple');
  const [interestRate, setInterestRate] = useState<number>(5.0);
  const [compoundFreq, setCompoundFreq] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load contacts
  useEffect(() => {
    async function loadContacts() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('contacts')
        .select(`
          id, owner_id, contact_id, nickname, created_at,
          profile:profiles!contacts_contact_id_fkey(id, email, full_name, phone, is_shadow)
        `)
        .eq('owner_id', user.id);

      if (data) {
        setContacts(data as any);
        if (!selectedPersonId && data.length > 0 && !preselectedContactId) {
          setSelectedPersonId(data[0].contact_id);
        }
      }
    }

    if (isOpen) {
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

      let targetUserId = selectedPersonId;

      // If user wants to add a new person inline
      if (isAddingNewPerson) {
        if (!newPersonEmail.trim()) {
          throw new Error('Please provide an email address for the other party');
        }

        // Check if profile exists with this email
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', newPersonEmail.trim().toLowerCase())
          .single();

        if (existingProfile) {
          targetUserId = existingProfile.id;
        } else {
          // Create shadow profile
          const shadowId = crypto.randomUUID();
          const { error: shadowError } = await supabase.from('profiles').insert({
            id: shadowId,
            email: newPersonEmail.trim().toLowerCase(),
            full_name: newPersonName.trim() || newPersonEmail.split('@')[0],
            is_shadow: true,
          });
          if (shadowError) throw shadowError;
          targetUserId = shadowId;
        }

        // Add to contacts
        await supabase.from('contacts').insert({
          owner_id: user.id,
          contact_id: targetUserId,
          nickname: newPersonName.trim() || null,
        });
      }

      if (!targetUserId) {
        throw new Error('Please select or add a person');
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
          principal: Number(principal),
          currency,
          interest_type: interestType,
          interest_rate: interestType === 'none' ? null : Number(interestRate),
          compound_freq: interestType === 'compound' ? compoundFreq : null,
          status: 'pending', // pending approval from other party
          notes: notes.trim() || null,
        })
        .select()
        .single();

      if (debtError) throw debtError;

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

      onDebtCreated?.();
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
                <select
                  value={selectedPersonId}
                  onChange={(e) => setSelectedPersonId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/10 outline-none text-sm font-medium"
                >
                  {contacts.length === 0 && (
                    <option value="">No contacts yet — click + New Person</option>
                  )}
                  {contacts.map((c) => (
                    <option key={c.contact_id} value={c.contact_id}>
                      {c.nickname || c.profile?.full_name || c.profile?.email} ({c.profile?.email})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-2 p-3 bg-[var(--surface)] rounded-xl border border-[var(--outline-variant)]/30">
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
                    required={isAddingNewPerson}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface-container-lowest)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
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
                    min="1"
                    step="any"
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
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-mono text-xs text-[var(--on-surface-variant)]">
                        Annual Percentage Rate (APR)
                      </span>
                      <span className="font-mono text-sm font-bold text-[var(--primary)]">
                        {interestRate}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="30"
                      step="0.5"
                      value={interestRate}
                      onChange={(e) => setInterestRate(Number(e.target.value))}
                      className="w-full accent-[var(--primary)] cursor-pointer"
                    />
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
                disabled={loading}
                className="w-full py-3 px-4 bg-[var(--primary)] text-[var(--on-primary)] rounded-xl font-bold font-mono text-sm hover:opacity-95 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">send</span>
                <span>{loading ? 'Creating...' : 'Send Request'}</span>
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
