'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency, SUPPORTED_CURRENCIES } from '@/lib/utils/currency';
import { round2 } from '@/lib/utils/interest';
import { parseSplitDetails, getCleanDebtNotes, buildSplitNotes, buildDebtNotesWithMetadata } from '@/lib/utils/split-bills';
import { Debt, SplitBillDetails } from '@/lib/types/database';
import { Avatar } from '../ui/Avatar';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { invalidateLedgerCache } from '@/lib/stores/ledger-store';

export interface EditPendingDebtModalProps {
  isOpen: boolean;
  debt: Debt;
  onClose: () => void;
  onDebtUpdated?: () => void;
}

export function EditPendingDebtModal({
  isOpen,
  debt,
  onClose,
  onDebtUpdated,
}: EditPendingDebtModalProps) {
  const supabase = React.useMemo(() => createClient(), []);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form states
  const [principalStr, setPrincipalStr] = useState<string>(() => String(debt.principal || ''));
  const [principal, setPrincipal] = useState<number>(() => Number(debt.principal) || 0);
  const [currency, setCurrency] = useState<string>(() => debt.currency || 'inr');
  const [interestType, setInterestType] = useState<'none' | 'simple' | 'compound'>(() => debt.interest_type || 'none');
  const [interestRateStr, setInterestRateStr] = useState<string>(() => String(debt.interest_rate || '0.00'));
  const [interestRate, setInterestRate] = useState<number>(() => Number(debt.interest_rate) || 0);
  const [compoundFreq, setCompoundFreq] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>(
    () => (debt.compound_freq as any) || 'monthly'
  );
  const [dueDate, setDueDate] = useState<string>(() => (debt.due_date ? debt.due_date.split('T')[0] : ''));
  const [notes, setNotes] = useState<string>(() => getCleanDebtNotes(debt.notes));

  // Split bill states
  const split = parseSplitDetails(debt);
  const isSplit = Boolean(split);
  const [splitTitle, setSplitTitle] = useState<string>(() => split?.title || '');
  const [applyToAllGroup, setApplyToAllGroup] = useState<boolean>(true);

  const prevIsOpenRef = React.useRef(false);
  const prevDebtIdRef = React.useRef<string | null>(null);

  // Sync state ONLY when modal is first opened or when editing a different debt
  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      return;
    }

    const isJustOpening = !prevIsOpenRef.current;
    const isDifferentDebt = prevDebtIdRef.current !== debt.id;

    async function initUser() {
      const user = await getCurrentUserFast(supabase);
      if (user) setCurrentUserId(user.id);
    }
    initUser();

    if (isJustOpening || isDifferentDebt) {
      setPrincipal(Number(debt.principal) || 0);
      setPrincipalStr(String(debt.principal || ''));
      setCurrency(debt.currency || 'inr');
      setInterestType(debt.interest_type || 'none');
      setInterestRate(Number(debt.interest_rate) || 0);
      setInterestRateStr(debt.interest_rate !== null && debt.interest_rate !== undefined ? String(debt.interest_rate) : '0.00');
      setCompoundFreq((debt.compound_freq as any) || 'monthly');
      setDueDate(debt.due_date ? debt.due_date.split('T')[0] : '');
      setNotes(getCleanDebtNotes(debt.notes));

      const s = parseSplitDetails(debt);
      setSplitTitle(s?.title || '');
      setError('');
      prevDebtIdRef.current = debt.id;
    }

    prevIsOpenRef.current = true;
  }, [isOpen, debt.id, debt.notes, debt.principal, debt.currency, debt.interest_type, debt.interest_rate, debt.compound_freq, debt.due_date, supabase]);

  const isLender = currentUserId ? debt.lender_id === currentUserId : true;
  const otherParty = isLender ? debt.borrower : debt.lender;
  const otherName = otherParty?.full_name || otherParty?.email || 'Counterparty';

  const handlePrincipalChange = (val: string) => {
    const sanitized = val.replace(/^0+(?=\d)/, '');
    setPrincipalStr(sanitized);
    setPrincipal(parseFloat(sanitized) || 0);
  };

  const handleInterestRateChange = (val: string) => {
    setInterestRateStr(val);
    const parsed = parseFloat(val);
    setInterestRate(isNaN(parsed) ? 0 : parsed);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (debt.status !== 'pending') {
      setError('This transaction has already been accepted or processed and cannot be modified.');
      return;
    }

    if (principal <= 0) {
      setError('Please enter a valid principal amount greater than zero.');
      return;
    }

    setLoading(true);

    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) throw new Error('User session expired. Please sign in again.');

      const cleanNote = notes.trim();

      const updatePayload: any = {
        principal: round2(principal),
        currency,
        interest_type: interestType,
        interest_rate: interestType !== 'none' ? round2(interestRate) : null,
        compound_freq: interestType === 'compound' ? compoundFreq : null,
        due_date: dueDate ? new Date(dueDate + 'T23:59:59Z').toISOString() : null,
        notes: buildDebtNotesWithMetadata(debt, { userNote: cleanNote }) || null,
      };

      // Handle split bill updates
      if (isSplit && split) {
        const updatedTitle = splitTitle.trim() || split.title;
        const targetUserId = isLender ? debt.borrower_id : debt.lender_id;
        const updatedParticipants = split.participants.map((pt) =>
          pt.userId === targetUserId
            ? { ...pt, shareAmount: round2(principal) }
            : pt
        );

        const updatedSplitDetails: SplitBillDetails = {
          ...split,
          title: updatedTitle,
          interestType,
          interestRate: interestType !== 'none' ? round2(interestRate) : null,
          compoundFreq: interestType === 'compound' ? compoundFreq : null,
          dueDate: dueDate ? new Date(dueDate + 'T23:59:59Z').toISOString() : null,
          participants: updatedParticipants,
        };

        // Always encode structured split notes for universal database compatibility
        updatePayload.notes = buildSplitNotes(updatedSplitDetails, cleanNote, debt.notes);
        updatePayload.split_details = updatedSplitDetails;

        // If batch-updating all pending participants in this split group
        if (applyToAllGroup && split.groupId) {
          try {
            // Find all pending debts created by current user
            const { data: userPendingDebts } = await supabase
              .from('debts')
              .select('id, notes, split_group_id')
              .eq('created_by', user.id)
              .eq('status', 'pending');

            if (userPendingDebts && userPendingDebts.length > 0) {
              const matchingOtherDebts = userPendingDebts.filter(
                (d: any) =>
                  d.id !== debt.id &&
                  (d.split_group_id === split.groupId ||
                    (typeof d.notes === 'string' && d.notes.includes(split.groupId)))
              );

              for (const other of matchingOtherDebts) {
                const otherCleanNote = getCleanDebtNotes(other.notes);
                const otherEncodedNotes = buildSplitNotes(updatedSplitDetails, otherCleanNote, other.notes);

                const otherPayload: any = {
                  interest_type: interestType,
                  interest_rate: interestType !== 'none' ? round2(interestRate) : null,
                  compound_freq: interestType === 'compound' ? compoundFreq : null,
                  due_date: dueDate ? new Date(dueDate + 'T23:59:59Z').toISOString() : null,
                  notes: otherEncodedNotes,
                };

                try {
                  await supabase
                    .from('debts')
                    .update({ ...otherPayload, split_details: updatedSplitDetails })
                    .eq('id', other.id)
                    .eq('status', 'pending');
                } catch (_) {
                  await supabase
                    .from('debts')
                    .update(otherPayload)
                    .eq('id', other.id)
                    .eq('status', 'pending');
                }
              }
            }
          } catch (e) {
            console.warn('Batch group update notice:', e);
          }
        }
      }

      // Update the debt agreement row (with fallback if split_details column doesn't exist yet)
      let updateSucceeded = false;
      try {
        const { error: primaryErr } = await supabase
          .from('debts')
          .update(updatePayload)
          .eq('id', debt.id)
          .eq('status', 'pending');

        if (!primaryErr) {
          updateSucceeded = true;
        }
      } catch (_) {}

      if (!updateSucceeded) {
        // Strip out split_details if column not in DB schema
        const fallbackPayload = { ...updatePayload };
        delete fallbackPayload.split_details;

        const { error: fallbackErr } = await supabase
          .from('debts')
          .update(fallbackPayload)
          .eq('id', debt.id)
          .eq('status', 'pending');

        if (fallbackErr) throw fallbackErr;
      }

      // Log in activity_log
      await supabase.from('activity_log').insert({
        user_id: user.id,
        debt_id: debt.id,
        action: 'debt_pending_edited',
        details: {
          oldPrincipal: debt.principal,
          newPrincipal: round2(principal),
          oldInterestType: debt.interest_type,
          newInterestType: interestType,
          oldInterestRate: debt.interest_rate,
          newInterestRate: interestRate,
          oldDueDate: debt.due_date,
          newDueDate: dueDate || null,
          notes: cleanNote || null,
          isSplit,
          splitTitle: isSplit ? splitTitle.trim() : null,
        },
      });

      invalidateLedgerCache();
      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      onDebtUpdated?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to update pending transaction:', err);
      setError(err.message || 'Failed to update transaction agreement.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isSplit ? 'Edit Split Bill Transaction' : 'Edit Pending Transaction'}
      subtitle={`Modify terms before ${otherName} reviews and accepts`}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-[var(--error)] text-xs font-mono flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
            <span>{error}</span>
          </div>
        )}

        {/* Counterparty Read-Only Info Card */}
        <div className="p-3.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 flex items-center justify-between gap-3">
          <Link
            href={`/directory/detail?id=${otherParty?.id || debt.id}`}
            onClick={onClose}
            className="flex items-center gap-2.5 min-w-0 hover:opacity-85 group cursor-pointer"
            title={`View ${otherName}'s contact ledger`}
          >
            <Avatar src={otherParty?.avatar_url} name={otherName} size="sm" />
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[var(--on-surface)] group-hover:text-[var(--primary)] group-hover:underline transition-colors block truncate">
                {otherName}
              </span>
              <span className="text-[11px] font-mono text-[var(--on-surface-variant)] block truncate">
                {isLender ? 'You Lent (They Owe You)' : 'You Borrowed (You Owe Them)'}
              </span>
            </div>
          </Link>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 shrink-0">
            Pending Review
          </span>
        </div>

        {/* Split Bill Context Banner */}
        {isSplit && (
          <div className="p-3 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-[var(--primary)]">
              <span className="material-symbols-outlined text-[16px]">call_split</span>
              <span>Split Bill Group Expense</span>
            </div>
            <div>
              <label className="block text-[11px] font-mono text-[var(--on-surface-variant)] mb-1">
                Expense Group Title
              </label>
              <input
                type="text"
                value={splitTitle}
                onChange={(e) => setSplitTitle(e.target.value)}
                placeholder="e.g. Dinner, Trip, Groceries"
                className="w-full px-3 py-2 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-base sm:text-xs font-mono outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>
        )}

        {/* Amount & Currency */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
              {isSplit ? "Participant's Share Amount" : 'Principal Amount'}
            </label>
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

          <div>
            <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
              Currency
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={isSplit}
              className="w-full px-3 py-3 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-base sm:text-sm uppercase outline-none focus:border-[var(--primary)] disabled:opacity-60"
            >
              {SUPPORTED_CURRENCIES.map((curr) => (
                <option key={curr.code} value={curr.code}>
                  {curr.code.toUpperCase()} ({curr.symbol})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Terms & Interest */}
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
                    Adjust agreement interest rate
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
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-base sm:text-sm font-bold text-right pr-6 outline-none focus:border-[var(--primary)]"
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

              {/* Compounding Frequency */}
              {interestType === 'compound' && (
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold mb-1">
                    Compounding Frequency
                  </label>
                  <select
                    value={compoundFreq}
                    onChange={(e) => setCompoundFreq(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-base sm:text-xs font-mono outline-none focus:border-[var(--primary)]"
                  >
                    <option value="daily">Daily Compounding</option>
                    <option value="weekly">Weekly Compounding</option>
                    <option value="monthly">Monthly Compounding</option>
                    <option value="yearly">Yearly Compounding</option>
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Repayment Due Date & Agreement Note */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold mb-1">
              Repayment Due Date (Optional)
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-base sm:text-xs font-mono outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div>
            <label className="block font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold mb-1">
              Agreement Note
            </label>
            <input
              type="text"
              placeholder="e.g. For dinner, concert tickets"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-base sm:text-xs font-mono outline-none focus:border-[var(--primary)]"
            />
          </div>
        </div>

        {/* Group batch update toggle for split bills */}
        {isSplit && (
          <label className="p-3 rounded-xl border border-[var(--outline-variant)]/20 bg-[var(--surface-container-low)] flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={applyToAllGroup}
              onChange={(e) => setApplyToAllGroup(e.target.checked)}
              className="mt-0.5 rounded text-[var(--primary)] focus:ring-[var(--primary)]"
            />
            <div className="text-xs">
              <span className="font-semibold text-[var(--on-surface)] block">
                Apply updated interest terms &amp; due date to all pending participants in this split
              </span>
              <span className="text-[11px] font-mono text-[var(--on-surface-variant)] block mt-0.5">
                Automatically synchronizes the updated APR and due date across other co-participants who haven&apos;t accepted yet.
              </span>
            </div>
          </label>
        )}

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
            disabled={loading || principal <= 0}
            className="px-6 py-2.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:brightness-110 active:scale-[0.98] transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                <span>Saving Changes...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">save</span>
                <span>Update Agreement ({formatCurrency(principal, currency)})</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
