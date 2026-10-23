'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Debt } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';
import { calculateDebtBalance } from '@/lib/utils/interest';
import { Avatar } from '@/components/ui/Avatar';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { claimUserProfile } from '@/lib/utils/claim-profile';
import { respondToDebtAgreement } from '@/lib/utils/debt-acceptance';
import { parseSplitDetails, getCleanDebtNotes } from '@/lib/utils/split-bills';
import Link from 'next/link';

function extractAcceptDebtId(searchParams: URLSearchParams | null): string {
  let id = '';

  const scan = (params: URLSearchParams) => {
    if (!id) {
      id = (
        params.get('token') ||
        params.get('amp;token') ||
        params.get('id') ||
        params.get('amp;id') ||
        params.get('debt') ||
        params.get('amp;debt') ||
        params.get('debt_id') ||
        params.get('amp;debt_id') ||
        params.get('debtId') ||
        params.get('amp;debtId') ||
        ''
      ).trim();
    }
  };

  if (searchParams) {
    scan(searchParams);
  }

  if (!id && typeof window !== 'undefined') {
    if (window.location.search) {
      try {
        scan(new URLSearchParams(window.location.search));
      } catch (_) {}
    }

    if (!id) {
      try {
        const fullHref = decodeURIComponent(window.location.href);
        const urlObj = new URL(fullHref, window.location.origin);
        scan(urlObj.searchParams);

        if (!id) {
          const match = fullHref.match(/(?:[?&#]|(?:&amp;))(?:token|id|debt|debt_id|debtId)=([0-9a-f-]{36}|[a-zA-Z0-9_-]+)/i);
          if (match) id = match[1].trim();
        }
      } catch (_) {}
    }

    if (!id && window.location.hash) {
      try {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^[#?]+/, ''));
        scan(hashParams);
      } catch (_) {}
    }

    if (!id) {
      const match = window.location.pathname.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      );
      if (match) id = match[0];
    }
  }

  return id;
}

function AcceptDebtContent() {
  const searchParams = useSearchParams();
  const [debtId, setDebtId] = useState(() => extractAcceptDebtId(searchParams));

  useEffect(() => {
    setDebtId(extractAcceptDebtId(searchParams));
  }, [searchParams]);

  const router = useRouter();

  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [debt, setDebt] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDebt() {
      if (!debtId) {
        setError('No agreement token or ID provided');
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUser(user);

        if (user) {
          await claimUserProfile(user);
        }

        // 1. Try secure RPC function (works even if user is not yet logged in)
        try {
          const { data: rpcData, error: rpcErr } = await supabase.rpc('get_debt_for_acceptance', {
            p_debt_id: debtId,
          });

          if (!rpcErr && rpcData && rpcData.length > 0) {
            const d = rpcData[0];
            setDebt({
              ...d,
              lender: {
                id: d.lender_id,
                full_name: d.lender_name,
                email: d.lender_email,
                avatar_url: d.lender_avatar,
              },
              borrower: {
                id: d.borrower_id,
                full_name: d.borrower_name,
                email: d.borrower_email,
                avatar_url: d.borrower_avatar,
              },
            });
            setLoading(false);
            return;
          }
        } catch (_) {}

        // 2. Direct table query fallback
        const { data, error: debtError } = await supabase
          .from('debts')
          .select(`
            *,
            lender:profiles!debts_lender_id_fkey(id, email, full_name, avatar_url),
            borrower:profiles!debts_borrower_id_fkey(id, email, full_name, avatar_url)
          `)
          .eq('id', debtId)
          .single();

        if (debtError) {
          if (!user) {
            // Unauthenticated user: will show prompt to sign in
            setError('');
          } else {
            throw debtError;
          }
        } else {
          setDebt(data as any);
        }
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
        router.push(`/login?next=${encodeURIComponent(`/accept?token=${debtId}`)}`);
        return;
      }

      await claimUserProfile(user);

      await respondToDebtAgreement(supabase, debt.id, decision);

      setMessage(
        decision === 'active'
          ? 'Agreement accepted! You can now view it on your dashboard.'
          : 'Agreement declined.'
      );

      setTimeout(() => {
        router.push('/dash');
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-6">
        <div className="font-mono text-xs text-on-surface-variant flex items-center gap-2">
          <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <span>Loading agreement details...</span>
        </div>
      </div>
    );
  }

  if (error || (!debt && currentUser)) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-6">
        <div className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant/30 max-w-md text-center shadow-xl">
          <span className="material-symbols-outlined text-4xl text-error mb-3">
            error_outline
          </span>
          <h2 className="font-heading text-lg font-bold text-on-surface">
            Agreement Not Found
          </h2>
          <p className="font-mono text-xs text-on-surface-variant mt-2 mb-6">
            {error || 'This debt record could not be loaded or may have been deleted.'}
          </p>
          <Link
            href="/dash"
            className="px-5 py-2.5 bg-primary text-on-primary rounded-xl font-mono text-xs font-bold inline-block"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!currentUser && !debt) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4 md:p-6">
        <div className="w-full max-w-md bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 shadow-xl text-center space-y-4">
          <div className="flex justify-center mb-2">
            <BrandLogo size="lg" showTagline={false} />
          </div>
          <h2 className="font-heading text-xl font-bold text-on-surface">
            Sign In to Verify Agreement
          </h2>
          <p className="text-xs font-mono text-on-surface-variant">
            Please sign in with your email to review and accept this debt agreement.
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(`/accept?token=${debtId}`)}`}
            className="w-full inline-block py-3 px-4 rounded-xl bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-95 shadow-md transition-all"
          >
            Sign In to Review &amp; Accept
          </Link>
        </div>
      </div>
    );
  }

  const lenderName = debt.lender?.full_name || debt.lender?.email || 'Counterparty';

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-lg bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 shadow-xl">
        <div className="text-center mb-6">
          <Avatar
            src={debt.lender?.avatar_url}
            name={lenderName}
            size="lg"
            className="mx-auto mb-3 shadow-md"
          />
          <h1 className="font-heading text-xl md:text-2xl font-bold text-on-surface">
            Review Debt Agreement
          </h1>
          <p className="font-mono text-xs text-on-surface-variant mt-1">
            <strong>{lenderName}</strong> recorded a financial transaction with you
          </p>
        </div>

        {message && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-mono text-center">
            {message}
          </div>
        )}

        <div className="p-5 rounded-xl bg-surface-container-low border border-outline-variant/20 space-y-4 mb-6">
          <div className="flex justify-between items-baseline">
            <span className="font-mono text-xs uppercase text-on-surface-variant font-semibold">
              Principal Amount
            </span>
            <span className="font-numeric-ticker text-2xl font-bold text-primary">
              {formatCurrency(debt.principal, debt.currency || 'inr')}
            </span>
          </div>

          <div className="space-y-2 text-xs font-mono pt-3 border-t border-outline-variant/10">
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Interest Engine</span>
              <span className="font-bold uppercase text-on-surface">
                {debt.interest_type === 'none' ? '0% (Interest-Free)' : `${debt.interest_type} (${debt.compound_freq || 'monthly'})`}
              </span>
            </div>

            {debt.interest_type !== 'none' && (
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Annual Rate (APR)</span>
                <span className="font-bold text-secondary">{debt.interest_rate}%</span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <span className="text-on-surface-variant">Origination Date</span>
              <span className="text-on-surface flex items-center gap-1.5 font-bold">
                <span>{new Date(debt.created_at).toLocaleDateString()}</span>
                {Math.max(0, Math.floor((new Date().getTime() - new Date(debt.created_at).getTime()) / (1000 * 60 * 60 * 24))) > 0 && (
                  <span className="text-[10px] font-bold text-secondary px-1.5 py-0.5 rounded bg-secondary/10 border border-secondary/20">
                    {Math.max(0, Math.floor((new Date().getTime() - new Date(debt.created_at).getTime()) / (1000 * 60 * 60 * 24)))} day{Math.max(0, Math.floor((new Date().getTime() - new Date(debt.created_at).getTime()) / (1000 * 60 * 60 * 24))) > 1 ? 's' : ''} ago
                  </span>
                )}
              </span>
            </div>

            {(() => {
              const daysAgo = Math.max(0, Math.floor((new Date().getTime() - new Date(debt.created_at).getTime()) / (1000 * 60 * 60 * 24)));
              if (daysAgo <= 0 || debt.interest_type === 'none') return null;
              const calc = calculateDebtBalance(debt, []);
              if (calc.totalAccruedInterest <= 0) return null;
              return (
                <>
                  <div className="flex justify-between text-secondary font-bold">
                    <span>Accrued Interest to Date ({daysAgo}d)</span>
                    <span>+{formatCurrency(calc.totalAccruedInterest, debt.currency || 'inr')}</span>
                  </div>
                  <div className="flex justify-between text-primary font-bold pt-1.5 border-t border-outline-variant/10">
                    <span>Current Effective Balance</span>
                    <span>{formatCurrency(calc.currentBalance, debt.currency || 'inr')}</span>
                  </div>
                </>
              );
            })()}

            {(() => {
              const split = parseSplitDetails(debt);
              const cleanNote = getCleanDebtNotes(debt.notes);
              if (!split && !cleanNote) return null;
              return (
                <div className="pt-2 border-t border-outline-variant/10 space-y-1.5">
                  {split && (
                    <div className="flex justify-between items-center">
                      <span className="text-on-surface-variant">Split Expense</span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/25 text-[11px] font-bold">
                        <span className="material-symbols-outlined text-[12px]">call_split</span>
                        <span>{split.title}</span>
                      </span>
                    </div>
                  )}
                  {cleanNote && (
                    <div>
                      <span className="text-on-surface-variant block mb-1">Notes / Terms:</span>
                      <p className="text-on-surface italic">{cleanNote}</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {!currentUser ? (
          <div className="text-center space-y-3">
            <p className="font-mono text-xs text-on-surface-variant">
              Sign in with your email to claim and verify this transaction
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(`/accept?token=${debtId}`)}`}
              className="w-full inline-block py-3 px-4 rounded-xl bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-95 shadow-md"
            >
              Sign In to Verify
            </Link>
          </div>
        ) : debt.status !== 'pending' ? (
          <div className="text-center space-y-3">
            <p className="font-mono text-xs text-on-surface-variant">
              This agreement is already marked as <strong>{debt.status}</strong>.
            </p>
            <Link
              href="/dash"
              className="w-full inline-block py-2.5 px-4 rounded-xl bg-surface-container text-on-surface font-mono text-xs font-semibold hover:bg-surface-container-high"
            >
              Go to Dashboard
            </Link>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={() => handleDecision('declined')}
              disabled={actionLoading}
              className="flex-1 py-3 px-4 rounded-xl border border-error/30 text-error font-mono text-xs font-bold hover:bg-error/10 transition-colors disabled:opacity-50"
            >
              Decline
            </button>
            <button
              onClick={() => handleDecision('active')}
              disabled={actionLoading}
              className="flex-1 py-3 px-4 rounded-xl bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-95 shadow-md transition-all disabled:opacity-50"
            >
              Accept Agreement
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AcceptDebtPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <AcceptDebtContent />
    </Suspense>
  );
}
