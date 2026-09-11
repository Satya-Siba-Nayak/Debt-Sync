'use client';

import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Debt } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';

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
  const [amount, setAmount] = useState<number>(Math.min(currentBalance, 500));
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not logged in');

      const paymentAmount = Number(amount);
      if (paymentAmount <= 0) throw new Error('Payment amount must be greater than 0');

      // Record payment
      const { error: paymentError } = await supabase.from('payments').insert({
        debt_id: debt.id,
        paid_by: user.id,
        amount: paymentAmount,
        currency: debt.currency || 'inr',
        note: note.trim() || 'Settlement payment',
      });

      if (paymentError) throw paymentError;

      // If payment fully clears the balance, mark as settled
      if (paymentAmount >= currentBalance) {
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
        action: 'payment_made',
        details: {
          amount: paymentAmount,
          currency: debt.currency || 'inr',
          note: note.trim(),
          remaining: Math.max(0, currentBalance - paymentAmount),
        },
      });

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
      title="Record Payment"
      subtitle={`Remaining outstanding balance: ${formatCurrency(currentBalance, debt.currency || 'inr', { showDecimals: true })}`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handlePayment} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-[var(--error)] text-sm border border-[var(--error)]/20">
            {error}
          </div>
        )}

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)]">
              Payment Amount
            </label>
            <button
              type="button"
              onClick={() => setAmount(currentBalance)}
              className="font-mono text-xs text-[var(--primary)] font-bold hover:underline"
            >
              Pay Full ({formatCurrency(currentBalance, debt.currency || 'inr')})
            </button>
          </div>
          <input
            type="number"
            min="1"
            step="any"
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
            placeholder="e.g. UPI transfer, Cash, GPay, Bank transfer"
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
            {loading ? 'Recording...' : 'Record Payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
