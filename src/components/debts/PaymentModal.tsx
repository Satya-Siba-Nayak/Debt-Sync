'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Debt } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';
import { round2 } from '@/lib/utils/interest';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { sendNotificationEmail } from '@/lib/utils/email-notifier';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  debt: Debt;
  currentBalance: number;
  onPaymentRecorded?: () => void;
}

export function PaymentModal({
  isOpen,
  onClose,
  debt,
  currentBalance,
  onPaymentRecorded,
}: PaymentModalProps) {
  const initialDefault = round2(Math.min(currentBalance, 500));
  const [amountStr, setAmountStr] = useState<string>(() => (initialDefault > 0 ? String(initialDefault) : ''));
  const [amount, setAmount] = useState<number>(initialDefault);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingLimits, setCheckingLimits] = useState(false);
  const [error, setError] = useState('');
  const [isLender, setIsLender] = useState(false);
  const [pendingAmount, setPendingAmount] = useState(0);

  const supabase = createClient();

  const handleAmountChange = (val: string) => {
    const sanitized = val.replace(/^0+(?=\d)/, '');
    setAmountStr(sanitized);
    setAmount(parseFloat(sanitized) || 0);
  };

  const setAmountUnified = (val: number) => {
    setAmount(val);
    setAmountStr(val > 0 ? String(val) : '');
  };

  useEffect(() => {
    if (!isOpen) return;

    async function loadRoleAndLimits() {
      setCheckingLimits(true);
      setError('');
      try {
        const user = await getCurrentUserFast(supabase);
        if (!user) return;

        const userIsLender = user.id === debt.lender_id;
        setIsLender(userIsLender);

        if (!userIsLender) {
          // Calculate existing pending unverified payments for this debt
          const { data: debtPayments } = await supabase
            .from('payments')
            .select('*')
            .eq('debt_id', debt.id)
            .eq('is_verified', false);

          const isDisputed = (p: any) =>
            p.status === 'disputed' ||
            (p.is_verified === false && p.verified_at != null) ||
            (typeof p.note === 'string' && p.note.includes('[DISPUTED]'));

          const activePending = (debtPayments || []).filter((p: any) => !isDisputed(p));
          const totalPending = round2(
            activePending.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)
          );
          setPendingAmount(totalPending);

          const allowable = Math.max(0, round2(currentBalance - totalPending));
          setAmountUnified(round2(Math.min(allowable, 500)));
        } else {
          setPendingAmount(0);
          setAmountUnified(round2(Math.min(currentBalance, 500)));
        }
      } catch (err) {
        console.error('Error loading payment limits:', err);
      } finally {
        setCheckingLimits(false);
      }
    }

    loadRoleAndLimits();
  }, [isOpen, debt.id, debt.lender_id, currentBalance, supabase]);

  const maxAllowable = isLender
    ? round2(currentBalance)
    : Math.max(0, round2(currentBalance - pendingAmount));
  const isBlockedByPending = !isLender && maxAllowable <= 0.009;

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) throw new Error('User not logged in');

      const rawNum = Number(amount);
      if (isNaN(rawNum) || rawNum <= 0) throw new Error('Payment amount must be greater than 0');
      const paymentAmount = round2(rawNum);

      const userIsLender = user.id === debt.lender_id;
      const isVerified = userIsLender;

      // Cap validation for borrower: Cannot request more than remaining balance minus pending unverified requests
      if (!userIsLender) {
        if (paymentAmount > maxAllowable + 0.005) {
          throw new Error(
            `Payment request of ${formatCurrency(paymentAmount, debt.currency || 'inr', { showDecimals: true })} exceeds allowable limit (${formatCurrency(maxAllowable, debt.currency || 'inr', { showDecimals: true })}). An existing request of ${formatCurrency(pendingAmount, debt.currency || 'inr', { showDecimals: true })} is already awaiting verification.`
          );
        }
      }

      // Record payment
      const { error: paymentError } = await supabase.from('payments').insert({
        debt_id: debt.id,
        paid_by: user.id,
        amount: paymentAmount,
        currency: debt.currency || 'inr',
        note: note.trim() || (isVerified ? 'Settlement payment' : 'Repayment reported'),
        is_verified: isVerified,
        verified_at: isVerified ? new Date().toISOString() : null,
        verified_by: isVerified ? user.id : null,
      });

      if (paymentError) throw paymentError;

      // If lender recorded payment and it clears the balance (within 0.005 threshold), settle immediately and purge orphaned unverified payments
      if (isVerified && paymentAmount >= currentBalance - 0.005) {
        await supabase
          .from('debts')
          .update({
            status: 'settled',
            settled_at: new Date().toISOString(),
          })
          .eq('id', debt.id);

        // Auto-purge any lingering unverified payments for this settled debt
        await supabase
          .from('payments')
          .delete()
          .eq('debt_id', debt.id)
          .eq('is_verified', false);
      }

      // Add activity log
      await supabase.from('activity_log').insert({
        user_id: user.id,
        debt_id: debt.id,
        action: isVerified ? 'payment_made' : 'repayment_reported',
        details: {
          amount: paymentAmount,
          currency: debt.currency || 'inr',
          note: note.trim(),
          is_verified: isVerified,
          remaining: isVerified ? Math.max(0, round2(currentBalance - paymentAmount)) : round2(currentBalance),
        },
      });

      // Dispatch email notification to lender when borrower reports a repayment
      if (!userIsLender) {
        (async () => {
          try {
            const { data: lenderProfile } = await supabase
              .from('profiles')
              .select('email, full_name')
              .eq('id', debt.lender_id)
              .single();

            if (lenderProfile?.email && !lenderProfile.email.endsWith('@phone.debtsync.local')) {
              sendNotificationEmail({
                type: 'payment_request',
                recipientEmail: lenderProfile.email,
                recipientName: lenderProfile.full_name,
                senderName: user.user_metadata?.full_name || user.email || 'The borrower',
                amount: paymentAmount,
                currency: debt.currency || 'inr',
                notes: note.trim() || undefined,
                debtId: debt.id,
              });
            }
          } catch (notifErr) {
            console.error('Failed to dispatch payment notification email:', notifErr);
          }
        })();
      }

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      onPaymentRecorded?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isLender ? 'Record Received Payment' : 'Report Repayment'}
      subtitle={`Remaining outstanding balance: ${formatCurrency(round2(currentBalance), debt.currency || 'inr', { showDecimals: true })}`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handlePayment} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-[var(--error)] text-sm border border-[var(--error)]/20">
            {error}
          </div>
        )}

        {!isLender && pendingAmount > 0 && isBlockedByPending && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
            <span className="material-symbols-outlined text-[20px] text-amber-500 shrink-0 mt-0.5">
              pending_actions
            </span>
            <div>
              <strong className="block font-semibold mb-0.5">Verification Pending Review:</strong>
              Repayment request(s) totaling{' '}
              <span className="font-mono font-bold">
                {formatCurrency(pendingAmount, debt.currency || 'inr', { showDecimals: true })}
              </span>{' '}
              are already awaiting confirmation from the lender. You cannot submit additional requests until the lender reviews or disputes the pending receipt.
            </div>
          </div>
        )}

        {!isLender && pendingAmount > 0 && !isBlockedByPending && (
          <div className="p-3 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/20 text-xs text-[var(--on-surface)] flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] text-[var(--primary)] shrink-0 mt-0.5">
              info
            </span>
            <div>
              <span className="font-mono font-semibold">
                {formatCurrency(pendingAmount, debt.currency || 'inr', { showDecimals: true })}
              </span>{' '}
              is currently awaiting lender verification. Maximum additional payment request allowed:{' '}
              <span className="font-mono font-bold text-[var(--primary)]">
                {formatCurrency(maxAllowable, debt.currency || 'inr', { showDecimals: true })}
              </span>.
            </div>
          </div>
        )}

        {!isLender && pendingAmount === 0 && (
          <div className="p-3 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/20 text-xs text-[var(--on-surface)] flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] text-[var(--primary)] shrink-0 mt-0.5">
              verified_user
            </span>
            <span>
              Repayments reported by borrowers require lender confirmation in their notification center before the ledger balance is settled.
            </span>
          </div>
        )}

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)]">
              Payment Amount
            </label>
            {maxAllowable > 0 && (
              <button
                type="button"
                onClick={() => setAmountUnified(round2(maxAllowable))}
                className="font-mono text-xs text-[var(--primary)] font-bold hover:underline"
              >
                Pay Full ({formatCurrency(round2(maxAllowable), debt.currency || 'inr', { showDecimals: true })})
              </button>
            )}
          </div>
          <input
            type="number"
            min="0.01"
            max={maxAllowable > 0 ? maxAllowable : undefined}
            step="0.01"
            required
            disabled={isBlockedByPending || loading || checkingLimits}
            value={amountStr}
            placeholder="0.00"
            onChange={(e) => handleAmountChange(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-lg font-bold outline-none focus:border-[var(--primary)] disabled:opacity-50 disabled:bg-[var(--surface-container-low)]"
          />
        </div>

        <div>
          <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
            Note / Payment Method
          </label>
          <input
            type="text"
            disabled={isBlockedByPending || loading || checkingLimits}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. UPI transfer, Cash, GPay ref #84912"
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)] disabled:opacity-50"
          />
        </div>

        <div className="pt-4 border-t border-[var(--outline-variant)]/20 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl border border-[var(--outline-variant)]/40 font-mono text-xs font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || checkingLimits || isBlockedByPending}
            className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--secondary)] text-[var(--on-secondary)] font-mono text-xs font-bold hover:opacity-95 disabled:opacity-50"
          >
            {loading
              ? 'Submitting...'
              : checkingLimits
              ? 'Checking...'
              : isLender
              ? 'Record Payment'
              : isBlockedByPending
              ? 'Verification Pending'
              : 'Submit for Verification'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
