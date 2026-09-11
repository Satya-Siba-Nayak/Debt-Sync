'use client';

import React, { useState, useEffect, use } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Debt } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface AcceptDebtPageProps {
  params: Promise<{ token: string }>;
}

export default function AcceptDebtPage({ params }: AcceptDebtPageProps) {
  const resolvedParams = use(params);
  const debtId = resolvedParams.token;
  const router = useRouter();

  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [debt, setDebt] = useState<Debt | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDebt() {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUser(user);

        const { data, error: debtError } = await supabase
          .from('debts')
          .select(`
            *,
            lender:profiles!debts_lender_id_fkey(id, email, full_name),
            borrower:profiles!debts_borrower_id_fkey(id, email, full_name)
          `)
          .eq('id', debtId)
          .single();

        if (debtError) throw debtError;
        setDebt(data as any);
      } catch (err: any) {
        setError(err.message || 'Could not load debt agreement');
      } finally {
        setLoading(false);
      }
    }

    loadDebt();
  }, [debtId, supabase]);

  const handleDecision = async (decision: 'active' | 'declined') => {
    if (!debt) return;
    setActionLoading(true);
    setError('');
    setMessage('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/login?next=/accept/${debtId}`);
        return;
      }

      const { error: updateError } = await supabase
        .from('debts')
        .update({
          status: decision,
          accepted_at: decision === 'active' ? new Date().toISOString() : null,
        })
        .eq('id', debt.id);

      if (updateError) throw updateError;

      // Add to activity log
      await supabase.from('activity_log').insert({
        user_id: user.id,
        debt_id: debt.id,
        action: decision === 'active' ? 'debt_accepted' : 'debt_declined',
        details: { decision },
      });

      setMessage(
        decision === 'active'
          ? 'Agreement accepted! You can now view it on your dashboard.'
          : 'Agreement declined.'
      );

      setTimeout(() => {
        router.push('/');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface)] flex items-center justify-center p-6">
        <div className="font-mono text-xs text-[var(--on-surface-variant)]">
          Loading agreement details...
        </div>
      </div>
    );
  }

  if (error || !debt) {
    return (
      <div className="min-h-screen bg-[var(--surface)] flex items-center justify-center p-6">
        <div className="bg-[var(--surface-container-lowest)] p-8 rounded-2xl border border-[var(--outline-variant)]/30 max-w-md text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--error)] mb-3">
            error_outline
          </span>
          <h2 className="font-heading text-lg font-bold text-[var(--on-surface)]">
            Agreement Not Found
          </h2>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-2 mb-6">
            {error || 'This debt record could not be loaded or may have been deleted.'}
          </p>
          <Link
            href="/"
            className="px-4 py-2 bg-[var(--primary)] text-[var(--on-primary)] rounded-xl font-mono text-xs font-bold"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const lenderName = debt.lender?.full_name || debt.lender?.email || 'Counterparty';

  return (
    <div className="min-h-screen bg-[var(--surface)] flex items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-lg bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-xl">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-[var(--primary-container)] text-[var(--on-primary-container)] font-bold text-xl flex items-center justify-center mx-auto mb-3 shadow-sm">
            D
          </div>
          <h1 className="font-heading text-xl md:text-2xl font-bold text-[var(--on-surface)]">
            Review Debt Agreement
          </h1>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-1">
            <strong>{lenderName}</strong> recorded a financial transaction with you
          </p>
        </div>

        {message && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-xs font-mono text-center">
            {message}
          </div>
        )}

        {/* Agreement summary card */}
        <div className="p-5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/20 space-y-4 mb-6">
          <div className="flex justify-between items-baseline">
            <span className="font-mono text-xs uppercase text-[var(--on-surface-variant)] font-semibold">
              Principal Amount
            </span>
            <span className="font-numeric-ticker text-2xl font-bold text-[var(--primary)]">
              {formatCurrency(debt.principal, debt.currency || 'inr')}
            </span>
          </div>

          <div className="space-y-2 text-xs font-mono pt-3 border-t border-[var(--outline-variant)]/10">
            <div className="flex justify-between">
              <span className="text-[var(--on-surface-variant)]">Interest Engine</span>
              <span className="font-bold uppercase text-[var(--on-surface)]">
                {debt.interest_type === 'none' ? '0% (Interest-Free)' : `${debt.interest_type} (${debt.compound_freq || 'monthly'})`}
              </span>
            </div>

            {debt.interest_type !== 'none' && (
              <div className="flex justify-between">
                <span className="text-[var(--on-surface-variant)]">Annual Rate (APR)</span>
                <span className="font-bold text-[var(--secondary)]">{debt.interest_rate}%</span>
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-[var(--on-surface-variant)]">Origination Date</span>
              <span className="text-[var(--on-surface)]">
                {new Date(debt.created_at).toLocaleDateString()}
              </span>
            </div>

            {debt.notes && (
              <div className="pt-2 border-t border-[var(--outline-variant)]/10">
                <span className="text-[var(--on-surface-variant)] block mb-1">Notes / Terms:</span>
                <p className="text-[var(--on-surface)] italic">{debt.notes}</p>
              </div>
            )}
          </div>
        </div>

        {!currentUser ? (
          <div className="text-center space-y-3">
            <p className="font-mono text-xs text-[var(--on-surface-variant)]">
              Sign in with your email to claim and verify this transaction
            </p>
            <Link
              href={`/login?next=/accept/${debtId}`}
              className="w-full inline-block py-3 px-4 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-95 shadow-sm"
            >
              Sign In to Verify
            </Link>
          </div>
        ) : debt.status !== 'pending' ? (
          <div className="text-center space-y-3">
            <p className="font-mono text-xs text-[var(--on-surface-variant)]">
              This agreement is already marked as <strong>{debt.status}</strong>.
            </p>
            <Link
              href="/"
              className="w-full inline-block py-2.5 px-4 rounded-xl bg-[var(--surface-container)] text-[var(--on-surface)] font-mono text-xs font-semibold hover:bg-[var(--surface-container-high)]"
            >
              Go to Dashboard
            </Link>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={() => handleDecision('declined')}
              disabled={actionLoading}
              className="flex-1 py-3 px-4 rounded-xl border border-[var(--error)]/30 text-[var(--error)] font-mono text-xs font-bold hover:bg-[var(--error)]/10 transition-colors disabled:opacity-50"
            >
              Decline
            </button>
            <button
              onClick={() => handleDecision('active')}
              disabled={actionLoading}
              className="flex-1 py-3 px-4 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-95 shadow-sm transition-all disabled:opacity-50"
            >
              Accept Agreement
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
