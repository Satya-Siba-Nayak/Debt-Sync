'use client';

import React, { useState, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { getDueDateInfo } from '@/lib/utils/due-date';

export type BulkStrategy = 'avalanche' | 'due_date' | 'fifo';

interface BulkPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  debts: Debt[];
  payments: Payment[];
  currentUserId: string;
  currency?: string;
  personName?: string;
  onPaymentCompleted?: () => void;
}

export function BulkPaymentModal({
  isOpen,
  onClose,
  debts,
  payments,
  currentUserId,
  currency = 'inr',
  personName = 'Counterparty',
  onPaymentCompleted,
}: BulkPaymentModalProps) {
  const supabase = createClient();

  const [direction, setDirection] = useState<'they_paid' | 'you_paid'>('they_paid');
  const [strategy, setStrategy] = useState<BulkStrategy>('avalanche');
  const [totalAmount, setTotalAmount] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filter active debts in the selected direction
  const eligibleDebts = useMemo(() => {
    return debts
      .filter((d) => d.status === 'active')
      .filter((d) => {
        if (direction === 'they_paid') {
          return d.lender_id === currentUserId; // Counterparty owes user
        } else {
          return d.borrower_id === currentUserId; // User owes counterparty
        }
      })
      .map((d) => {
        const debtPayments = payments.filter((p) => p.debt_id === d.id);
        const calc = calculateDebtBalance(d, debtPayments);
        return {
          debt: d,
          currentBalance: calc.currentBalance,
          accruedInterest: calc.totalAccruedInterest,
          rate: Number(d.interest_rate) || 0,
        };
      })
      .filter((item) => item.currentBalance > 0);
  }, [debts, payments, currentUserId, direction]);

  const totalOutstandingInDirection = eligibleDebts.reduce(
    (sum, item) => sum + item.currentBalance,
    0
  );

  // Compute allocation across eligible debts
  const allocations = useMemo(() => {
    const paymentSum = typeof totalAmount === 'number' ? totalAmount : 0;
    if (paymentSum <= 0 || eligibleDebts.length === 0) return [];

    // Sort according to selected strategy
    const sorted = [...eligibleDebts].sort((a, b) => {
      if (strategy === 'avalanche') {
        // Highest APR first
        return b.rate - a.rate;
      }
      if (strategy === 'due_date') {
        // Earliest due date first (debts without due date put at end)
        const dateA = a.debt.due_date ? new Date(a.debt.due_date).getTime() : Infinity;
        const dateB = b.debt.due_date ? new Date(b.debt.due_date).getTime() : Infinity;
        return dateA - dateB;
      }
      // FIFO: Oldest created_at first
      return new Date(a.debt.created_at).getTime() - new Date(b.debt.created_at).getTime();
    });

    let remainingFund = paymentSum;

    return sorted.map((item) => {
      if (remainingFund <= 0) {
        return {
          debt: item.debt,
          currentBalance: item.currentBalance,
          allocated: 0,
          newBalance: item.currentBalance,
          rate: item.rate,
        };
      }

      const allocated = Math.min(remainingFund, item.currentBalance);
      remainingFund -= allocated;

      return {
        debt: item.debt,
        currentBalance: item.currentBalance,
        allocated,
        newBalance: Math.max(0, item.currentBalance - allocated),
        rate: item.rate,
      };
    });
  }, [eligibleDebts, totalAmount, strategy]);

  const totalAllocated = allocations.reduce((sum, a) => sum + a.allocated, 0);
  const excessAmount = typeof totalAmount === 'number' ? Math.max(0, totalAmount - totalAllocated) : 0;

  const handleApplyPayments = async (e: React.FormEvent) => {
    e.preventDefault();
    const paymentNum = typeof totalAmount === 'number' ? totalAmount : 0;
    if (paymentNum <= 0) {
      setError('Please enter a valid payment amount');
      return;
    }
    if (allocations.length === 0 || totalAllocated <= 0) {
      setError('No eligible debts available to receive payment');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const isVerified = direction === 'they_paid';

      for (const item of allocations) {
        if (item.allocated <= 0) continue;

        // 1. Insert payment record
        const { error: pErr } = await supabase.from('payments').insert({
          debt_id: item.debt.id,
          paid_by: user.id,
          amount: item.allocated,
          currency: item.debt.currency || currency,
          note: note.trim()
            ? `Smart Bulk Payment: ${note.trim()}`
            : `Smart Bulk Repayment (${strategy.toUpperCase()})`,
          is_verified: isVerified,
          verified_at: isVerified ? new Date().toISOString() : null,
          verified_by: isVerified ? user.id : null,
        });

        if (pErr) throw pErr;

        // 2. Settle debt if cleared and verified
        if (isVerified && item.newBalance <= 0.01) {
          await supabase
            .from('debts')
            .update({
              status: 'settled',
              settled_at: new Date().toISOString(),
            })
            .eq('id', item.debt.id);
        }

        // 3. Activity log
        await supabase.from('activity_log').insert({
          user_id: user.id,
          debt_id: item.debt.id,
          action: isVerified ? 'payment_made' : 'repayment_reported',
          details: {
            amount: item.allocated,
            strategy,
            is_verified: isVerified,
            remaining: isVerified ? item.newBalance : item.currentBalance,
            cleared: isVerified && item.newBalance <= 0.01,
          },
        });
      }

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      onPaymentCompleted?.();
      onClose();
    } catch (err: any) {
      console.error('Bulk payment error:', err);
      setError(err.message || 'Failed to process bulk payments');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Smart Bulk Repayment"
      subtitle={`Auto-distribute a single lump sum across multiple loans with ${personName}`}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleApplyPayments} className="space-y-5">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-error text-xs font-mono border border-error/30">
            {error}
          </div>
        )}

        {/* Direction Switcher */}
        <div className="space-y-1.5">
          <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant font-semibold block">
            Payment Direction
          </label>
          <div className="grid grid-cols-2 gap-2 bg-surface-container p-1 rounded-xl border border-outline-variant/30">
            <button
              type="button"
              onClick={() => setDirection('they_paid')}
              className={`py-2 px-3 rounded-lg font-mono text-xs font-bold transition-all ${
                direction === 'they_paid'
                  ? 'bg-surface-container-lowest text-secondary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              They Paid You (Loans They Owe)
            </button>
            <button
              type="button"
              onClick={() => setDirection('you_paid')}
              className={`py-2 px-3 rounded-lg font-mono text-xs font-bold transition-all ${
                direction === 'you_paid'
                  ? 'bg-surface-container-lowest text-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              You Paid Them (Loans You Owe)
            </button>
          </div>
        </div>

        {/* Repayment Strategy */}
        <div className="space-y-1.5">
          <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant font-semibold block">
            Repayment Strategy
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setStrategy('avalanche')}
              className={`p-3 rounded-xl border text-left transition-all ${
                strategy === 'avalanche'
                  ? 'border-primary bg-primary/10 shadow-xs'
                  : 'border-outline-variant/30 bg-surface hover:bg-surface-container-low'
              }`}
            >
              <div className="font-mono text-xs font-bold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-primary">trending_down</span>
                <span>Avalanche</span>
              </div>
              <p className="text-[11px] text-on-surface-variant mt-1 leading-snug">
                Highest APR first. Minimizes total interest paid.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setStrategy('due_date')}
              className={`p-3 rounded-xl border text-left transition-all ${
                strategy === 'due_date'
                  ? 'border-primary bg-primary/10 shadow-xs'
                  : 'border-outline-variant/30 bg-surface hover:bg-surface-container-low'
              }`}
            >
              <div className="font-mono text-xs font-bold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-amber-500">event_upcoming</span>
                <span>Due Date</span>
              </div>
              <p className="text-[11px] text-on-surface-variant mt-1 leading-snug">
                Clears urgent &amp; nearest due date obligations first.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setStrategy('fifo')}
              className={`p-3 rounded-xl border text-left transition-all ${
                strategy === 'fifo'
                  ? 'border-primary bg-primary/10 shadow-xs'
                  : 'border-outline-variant/30 bg-surface hover:bg-surface-container-low'
              }`}
            >
              <div className="font-mono text-xs font-bold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-secondary">history</span>
                <span>Oldest (FIFO)</span>
              </div>
              <p className="text-[11px] text-on-surface-variant mt-1 leading-snug">
                Clears oldest loan agreements chronologically.
              </p>
            </button>
          </div>
        </div>

        {/* Total Payment Amount */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant font-semibold">
              Lump Sum Amount ({currency.toUpperCase()})
            </label>
            {totalOutstandingInDirection > 0 && (
              <button
                type="button"
                onClick={() => setTotalAmount(Math.round(totalOutstandingInDirection * 100) / 100)}
                className="font-mono text-xs text-primary font-bold hover:underline"
              >
                Pay All ({formatCurrency(totalOutstandingInDirection, currency)})
              </button>
            )}
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-base font-bold text-on-surface-variant">
              {currency === 'inr' ? '₹' : currency.toUpperCase()}
            </span>
            <input
              type="number"
              min="1"
              step="any"
              required
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
              placeholder="e.g. 5000"
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-outline-variant/40 bg-surface text-on-surface font-mono font-bold text-lg focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
            />
          </div>
        </div>

        {/* Optional Note */}
        <div>
          <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant block mb-1">
            Payment Note <span className="normal-case text-[var(--outline)]">(optional)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. UPI transfer reference, consolidated month-end settlement"
            className="w-full px-4 py-2.5 rounded-xl border border-outline-variant/40 bg-surface text-on-surface text-xs outline-none focus:border-primary"
          />
        </div>

        {/* Live Allocation Preview */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-mono text-xs uppercase tracking-wider text-on-surface-variant font-semibold">
              Allocation Breakdown ({allocations.length} Loans)
            </span>
            {excessAmount > 0 && (
              <span className="font-mono text-xs text-amber-500 font-medium">
                Unallocated Excess: +{formatCurrency(excessAmount, currency)}
              </span>
            )}
          </div>

          {allocations.length === 0 ? (
            <div className="p-6 rounded-xl border border-dashed border-outline-variant/30 text-center text-xs font-mono text-on-surface-variant">
              {eligibleDebts.length === 0
                ? `No active debts found for "${direction === 'they_paid' ? 'They owe you' : 'You owe them'}"`
                : 'Enter a payment amount above to preview the smart allocation breakdown'}
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {allocations.map((item) => {
                const dueInfo = getDueDateInfo(item.debt.due_date, item.debt.status);
                const isCleared = item.newBalance <= 0.01;

                return (
                  <div
                    key={item.debt.id}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs font-mono transition-all ${
                      item.allocated > 0
                        ? isCleared
                          ? 'border-emerald-500/40 bg-emerald-500/5'
                          : 'border-primary/30 bg-surface-container-low'
                        : 'border-outline-variant/20 opacity-60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-on-surface">
                          Orig: {formatCurrency(item.debt.principal, item.debt.currency || currency)}
                        </span>
                        {item.rate > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold">
                            {item.rate}% APR
                          </span>
                        )}
                        {dueInfo && (
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${dueInfo.className}`}>
                            {dueInfo.text}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-on-surface-variant mt-0.5">
                        Balance: {formatCurrency(item.currentBalance, currency)} &rarr; New: {formatCurrency(item.newBalance, currency)}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-bold text-sm text-secondary block">
                        +{formatCurrency(item.allocated, currency)}
                      </span>
                      {isCleared ? (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
                          Fully Cleared
                        </span>
                      ) : (
                        <span className="text-[10px] text-on-surface-variant">
                          Partial
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-3 border-t border-outline-variant/20">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-outline-variant/40 font-mono text-xs font-bold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || totalAllocated <= 0}
            className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-on-primary border-t-transparent animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">done_all</span>
                <span>Confirm &amp; Apply Payments</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
