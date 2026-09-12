'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Debt } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';
import { round2 } from '@/lib/utils/interest';

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
  const [amount, setAmount] = useState<number>(round2(Math.min(currentBalance, 500)));
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  const [isLender, setIsLender] = useState(false);

  useEffect(() => {
    async function checkRole() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setIsLender(user.id === debt.lender_id);
      }
    }
    checkRole();
  }, [debt.lender_id, supabase]);

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not logged in');

      const rawNum = Number(amount);
      if (isNaN(rawNum) || rawNum <= 0) throw new Error('Payment amount must be greater than 0');
      const paymentAmount = round2(rawNum);

      const userIsLender = user.id === debt.lender_id;
      const isVerified = userIsLender;

      // Record payment
      const { error: paymentError } = await supabase.from('payments').insert({
        debt_id: debt.id,
        paid_by: user.id,
        amount: paymentAmount,
        currency: debt.currency || 'inr',
        note: note.trim() || 'Settlement payment',
        is_verified: isVerified,
        verified_at: isVerified ? new Date().toISOString() : null,
        verified_by: isVerified ? user.id : null,
      });

      if (paymentError) throw paymentError;

      // If lender recorded payment and it clears the balance (within 0.005 threshold), settle immediately
      if (isVerified && paymentAmount >= currentBalance - 0.005) {
        await supabase
          .from('debts')
          .update({
            status: 'settled',
            settled_at: new Date().toISOString(),
          })
          .eq('id', debt.id);
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

        {!isLender && (
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
            <button
              type="button"
              onClick={() => setAmount(round2(currentBalance))}
              className="font-mono text-xs text-[var(--primary)] font-bold hover:underline"
            >
              Pay Full ({formatCurrency(round2(currentBalance), debt.currency || 'inr', { showDecimals: true })})
            </button>
          </div>
          <input
            type="number"
            min="0.01"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-lg font-bold outline-none focus:border-[var(--primary)]"
          />
        </div>

        <div>
          <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
            Note / Payment Method
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. UPI transfer, Cash, GPay ref #84912"
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
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
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--secondary)] text-[var(--on-secondary)] font-mono text-xs font-bold hover:opacity-95 disabled:opacity-50"
          >
            {loading ? 'Submitting...' : isLender ? 'Record Payment' : 'Submit for Verification'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
