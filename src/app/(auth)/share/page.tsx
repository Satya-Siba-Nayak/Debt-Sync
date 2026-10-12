'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils/currency';
import { calculateDebtBalance } from '@/lib/utils/interest';
import { Avatar } from '@/components/ui/Avatar';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { claimUserProfile } from '@/lib/utils/claim-profile';
import {
  parseSplitDetails,
  parseShareMetadata,
  getCleanDebtNotes,
  buildDebtNotesWithMetadata,
  generateShareToken,
  isUserParticipantInDebt,
  TransactionShareMetadata,
} from '@/lib/utils/split-bills';

function maskEmailAddress(email?: string | null): string {
  if (!email || !email.includes('@')) return 'Protected Email';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

function ShareTransactionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const debtId = searchParams.get('id') || '';
  const mode = searchParams.get('mode') || '';
  const token = searchParams.get('token') || '';

  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [debt, setDebt] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [shareMeta, setShareMeta] = useState<TransactionShareMetadata | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [copiedType, setCopiedType] = useState<'participant' | 'global' | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);
  const [error, setError] = useState('');

  const loadSharedTransaction = useCallback(async () => {
    if (!debtId) {
      setError('No transaction ID specified in share link.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUser(user || null);

      if (user) {
        await claimUserProfile(user);
        const { data: pData } = await supabase
          .from('profiles')
          .select('id, email, full_name, secondary_emails, is_isolated')
          .eq('id', user.id)
          .maybeSingle();
        setUserProfile(pData);
      }

      let resolvedDebt: any = null;

      // 1. Try direct query first (provides richest columns like counterparty_notes when RLS allows)
      if (user) {
        const { data: directDebt } = await supabase
          .from('debts')
          .select(
            `
            *,
            lender:profiles!debts_lender_id_fkey(id, email, full_name, avatar_url, network_score),
            borrower:profiles!debts_borrower_id_fkey(id, email, full_name, avatar_url, network_score)
          `
          )
          .eq('id', debtId)
          .maybeSingle();

        if (directDebt) {
          resolvedDebt = directDebt;
        }
      }

      // 2. Fallback to SECURITY DEFINER RPC (works for unauthenticated global link viewers & split group members)
      if (!resolvedDebt) {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('get_debt_for_acceptance', {
          p_debt_id: debtId,
        });

        if (!rpcErr && rpcData && rpcData.length > 0) {
          const d = rpcData[0];
          resolvedDebt = {
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
          };
        }
      }

      if (!resolvedDebt) {
        setError('Transaction record not found or has been removed.');
        setLoading(false);
        return;
      }

      const parsedShare = parseShareMetadata(resolvedDebt);
      setShareMeta(parsedShare);

      // Fetch live payments & activity logs if authenticated & authorized, otherwise fallback to snapshot
      let resolvedPayments: any[] = [];
      let resolvedLogs: any[] = [];

      if (user) {
        const [payRes, logRes] = await Promise.all([
          supabase
            .from('payments')
            .select('*')
            .eq('debt_id', debtId)
            .order('created_at', { ascending: false }),
          supabase
            .from('activity_log')
            .select('*')
            .eq('debt_id', debtId)
            .order('created_at', { ascending: false })
            .limit(25),
        ]);

        if (payRes.data && payRes.data.length > 0) {
          resolvedPayments = payRes.data;
        }
        if (logRes.data && logRes.data.length > 0) {
          resolvedLogs = logRes.data;
        }
      }

      if (resolvedPayments.length === 0 && parsedShare?.snapshot?.payments) {
        resolvedPayments = parsedShare.snapshot.payments.map((p) => ({
          id: p.id,
          amount: p.amount,
          currency: p.currency,
          created_at: p.created_at,
          is_verified: p.is_verified !== false,
          verified_at: p.verified_at || null,
          payment_method: p.payment_method || null,
          transaction_ref: p.transaction_ref || null,
          note: p.note || null,
        }));
      }

      if (resolvedLogs.length === 0 && parsedShare?.snapshot?.auditLog) {
        resolvedLogs = parsedShare.snapshot.auditLog.map((a) => ({
          id: a.id,
          action: a.action,
          created_at: a.created_at,
          details: a.details || {},
        }));
      }

      if (!resolvedDebt.counterparty_notes && parsedShare?.snapshot?.counterpartyNotes) {
        resolvedDebt.counterparty_notes = parsedShare.snapshot.counterpartyNotes;
      }

      setDebt(resolvedDebt);
      setPayments(resolvedPayments);
      setActivityLogs(resolvedLogs);
    } catch (err: any) {
      setError(err.message || 'Unable to load shared transaction.');
    } finally {
      setLoading(false);
    }
  }, [debtId, supabase]);

  useEffect(() => {
    loadSharedTransaction();
  }, [loadSharedTransaction]);

  // Real-time subscription so if either party disables global sharing while viewer has page open, it revokes immediately
  useEffect(() => {
    if (!debtId) return;
    const channel = supabase
      .channel(`shared_debt_live_${debtId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'debts',
          filter: `id=eq.${debtId}`,
        },
        (payload: any) => {
          if (payload.new) {
            setDebt((prev: any) => (prev ? { ...prev, ...payload.new } : prev));
            setShareMeta(parseShareMetadata(payload.new as any));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [debtId, supabase]);

  const isParticipant = Boolean(
    debt &&
      currentUser &&
      isUserParticipantInDebt(debt, currentUser, userProfile?.secondary_emails || [])
  );

  const isDirectParty = Boolean(
    debt &&
      currentUser &&
      (debt.lender_id === currentUser.id ||
        debt.borrower_id === currentUser.id ||
        debt.created_by === currentUser.id)
  );

  const isGlobalAccessValid = Boolean(
    debt &&
      debt.status !== 'declined' &&
      shareMeta?.globalEnabled === true &&
      shareMeta?.globalToken &&
      token &&
      token === shareMeta.globalToken
  );

  const canViewTransaction = isParticipant || isGlobalAccessValid;

  const handleToggleGlobalShare = async (action: 'enable' | 'disable' | 'regenerate') => {
    if (!debt || !currentUser || !isDirectParty) return;
    setShareLoading(true);
    setFeedbackMessage(null);

    try {
      if (userProfile?.is_isolated && action !== 'disable') {
        throw new Error('Your account is currently restricted from creating public global links.');
      }

      const actorName =
        userProfile?.full_name ||
        currentUser.user_metadata?.full_name ||
        currentUser.email ||
        'A participant';
      const nowIso = new Date().toISOString();
      const debtCurrency = debt.currency || 'inr';

      let nextShareMeta: TransactionShareMetadata;
      if (action === 'enable' || action === 'regenerate') {
        const newToken = generateShareToken('gsh');
        nextShareMeta = {
          globalEnabled: true,
          globalToken: newToken,
          enabledBy: currentUser.id,
          enabledByName: actorName,
          enabledAt: nowIso,
          disabledBy: null,
          disabledByName: null,
          disabledAt: null,
          dismissedAlertBy: [currentUser.id],
          snapshot: {
            updatedAt: nowIso,
            counterpartyNotes: debt.counterparty_notes || null,
            dueDate: debt.due_date || null,
            settledAt: debt.settled_at || null,
            payments: payments.slice(0, 15).map((p) => ({
              id: p.id,
              amount: Number(p.amount) || 0,
              currency: p.currency || debtCurrency,
              created_at: p.created_at || p.paid_at,
              is_verified: p.is_verified !== false,
              verified_at: p.verified_at || null,
              payment_method: p.payment_method || null,
              transaction_ref: p.transaction_ref || null,
              note: getCleanDebtNotes(p.note || p.notes),
            })),
            auditLog: [
              {
                id: `share_${Date.now()}`,
                action: action === 'enable' ? 'global_share_enabled' : 'global_share_regenerated',
                created_at: nowIso,
                details: {
                  by_user_id: currentUser.id,
                  by_name: actorName,
                  actorName,
                },
              },
              ...activityLogs.slice(0, 12).map((a) => ({
                id: a.id,
                action: a.action,
                created_at: a.created_at,
                details: a.details || {},
              })),
            ],
          },
        };
      } else {
        nextShareMeta = {
          globalEnabled: false,
          globalToken: null,
          enabledBy: shareMeta?.enabledBy || null,
          enabledByName: shareMeta?.enabledByName || null,
          enabledAt: shareMeta?.enabledAt || null,
          disabledBy: currentUser.id,
          disabledByName: actorName,
          disabledAt: nowIso,
          dismissedAlertBy: [],
        };
      }

      const updatedNotes = buildDebtNotesWithMetadata(debt, {
        shareMetadata: nextShareMeta,
      });

      const { error: updateError } = await supabase
        .from('debts')
        .update({
          notes: updatedNotes,
          updated_at: nowIso,
        })
        .eq('id', debt.id);

      if (updateError) throw updateError;

      await supabase.from('activity_log').insert({
        user_id: currentUser.id,
        debt_id: debt.id,
        action:
          action === 'enable'
            ? 'global_share_enabled'
            : action === 'regenerate'
            ? 'global_share_regenerated'
            : 'global_share_disabled',
        details: {
          by_user_id: currentUser.id,
          by_name: actorName,
          actorName,
          note:
            action === 'enable'
              ? `Global public link enabled by ${actorName}.`
              : action === 'regenerate'
              ? `Global public link rotated by ${actorName}.`
              : `Global public link turned off by ${actorName}.`,
        },
      });

      setDebt((prev: any) => (prev ? { ...prev, notes: updatedNotes, updated_at: nowIso } : prev));
      setShareMeta(nextShareMeta);

      if (action === 'disable') {
        setFeedbackMessage({
          type: 'info',
          text: 'Global public link has been turned OFF. Anyone with the public link can no longer view this transaction.',
        });
      } else {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const newGlobalUrl = `${origin}/share?id=${debt.id}&token=${nextShareMeta.globalToken}`;
        try {
          await navigator.clipboard.writeText(newGlobalUrl);
          setCopiedType('global');
          setTimeout(() => setCopiedType(null), 2500);
        } catch (_) {}
        setFeedbackMessage({
          type: 'success',
          text:
            action === 'enable'
              ? 'Global public link enabled and copied to clipboard!'
              : 'Global link rotated! Previous public links are now invalidated.',
        });
        router.replace(`/share?id=${debt.id}&token=${nextShareMeta.globalToken}`);
      }
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Could not update sharing settings.',
      });
    } finally {
      setShareLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface)] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-7 h-7 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin" />
          <div className="font-mono text-xs text-[var(--on-surface-variant)]">
            Verifying transaction link &amp; access permissions...
          </div>
        </div>
      </div>
    );
  }

  const currentRelativeUrl = `/share?id=${encodeURIComponent(debtId)}${
    mode ? `&mode=${encodeURIComponent(mode)}` : ''
  }${token ? `&token=${encodeURIComponent(token)}` : ''}`;

  if (error || !debt) {
    return (
      <div className="min-h-screen bg-[var(--surface)] flex flex-col">
        <header className="w-full px-4 md:px-8 py-4 border-b border-[var(--outline-variant)]/20 flex items-center justify-between">
          <Link href="/">
            <BrandLogo size="sm" showTagline={false} />
          </Link>
          <ThemeToggle />
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-[var(--surface-container-lowest)] p-8 rounded-2xl border border-[var(--outline-variant)]/30 max-w-md w-full text-center shadow-xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-500">
              <span className="material-symbols-outlined text-2xl">error</span>
            </div>
            <h2 className="font-heading text-lg font-bold text-[var(--on-surface)]">
              Transaction Not Found
            </h2>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] leading-relaxed">
              {error || 'This transaction link is invalid or the record has been deleted.'}
            </p>
            <div className="pt-2">
              <Link
                href="/"
                className="px-5 py-2.5 bg-[var(--primary)] text-[var(--on-primary)] rounded-xl font-mono text-xs font-bold inline-block"
              >
                Go to DebtSync
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Access Gate when viewer is neither a verified participant nor holds an active global token
  if (!canViewTransaction) {
    const wasGlobalLinkAttempt = Boolean(token);
    const disabledByInfo = shareMeta?.disabledByName
      ? `Global sharing was turned off by ${shareMeta.disabledByName}.`
      : 'Global public sharing is currently turned OFF for this transaction.';

    return (
      <div className="min-h-screen bg-[var(--surface)] flex flex-col">
        <header className="w-full px-4 md:px-8 py-4 border-b border-[var(--outline-variant)]/20 flex items-center justify-between">
          <Link href="/">
            <BrandLogo size="sm" showTagline={false} />
          </Link>
          <ThemeToggle />
        </header>
        <div className="flex-1 flex items-center justify-center p-4 md:p-6">
          <div className="w-full max-w-md bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-xl text-center space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-[var(--primary)]/10 border border-[var(--primary)]/20 flex items-center justify-center mx-auto text-[var(--primary)]">
              <span className="material-symbols-outlined text-3xl">
                {wasGlobalLinkAttempt ? 'link_off' : 'lock'}
              </span>
            </div>

            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface-container-high)] font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--on-surface-variant)]">
                <span className="material-symbols-outlined text-[12px]">verified_user</span>
                <span>
                  {wasGlobalLinkAttempt
                    ? 'Global Link Inactive'
                    : 'Participants-Only Protected Link'}
                </span>
              </div>
              <h1 className="font-heading text-xl font-bold text-[var(--on-surface)]">
                {wasGlobalLinkAttempt
                  ? 'Public Link Disabled or Expired'
                  : 'Participant Verification Required'}
              </h1>
              <p className="text-xs text-[var(--on-surface-variant)] leading-relaxed">
                {wasGlobalLinkAttempt
                  ? `${disabledByInfo} Only participating members of this transaction (Lender, Borrower, or Split Bill members) can open it.`
                  : 'This transaction link is private and can only be opened by participating members of the agreement (including Split Bill participants).'}
              </p>
            </div>

            {currentUser ? (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 text-left space-y-1.5">
                <div className="font-mono text-[11px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px]">gpp_maybe</span>
                  <span>Signed-in account is not a participant</span>
                </div>
                <p className="text-[11px] text-[var(--on-surface-variant)] leading-relaxed">
                  You are signed in as <strong className="text-[var(--on-surface)]">{currentUser.email}</strong>, which is not listed as a party or split participant on this transaction.
                </p>
              </div>
            ) : null}

            <div className="space-y-2.5 pt-1">
              {!currentUser ? (
                <Link
                  href={`/login?next=${encodeURIComponent(currentRelativeUrl)}`}
                  className="w-full py-3 px-4 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-95 shadow-md transition-all flex items-center justify-center gap-2 min-h-[44px]"
                >
                  <span className="material-symbols-outlined text-[16px]">login</span>
                  <span>Sign In as Participant to View</span>
                </Link>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await supabase.auth.signOut();
                      router.push(`/login?next=${encodeURIComponent(currentRelativeUrl)}`);
                    }}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-95 transition-all cursor-pointer min-h-[44px]"
                  >
                    Switch Account
                  </button>
                  <Link
                    href="/"
                    className="flex-1 py-2.5 px-4 rounded-xl border border-[var(--outline-variant)]/40 font-mono text-xs font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container)] flex items-center justify-center min-h-[44px]"
                  >
                    Go to Dashboard
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Authorized View (Either Verified Participant OR Active Global Link)
  const calc = calculateDebtBalance(debt, payments);
  const debtCurrency = debt.currency || 'inr';
  const splitDetails = parseSplitDetails(debt);
  const cleanCreatorNote = getCleanDebtNotes(debt.notes);

  const lenderName = debt.lender?.full_name || debt.lender?.email || 'Lender';
  const borrowerName = debt.borrower?.full_name || debt.borrower?.email || 'Borrower';
  const lenderEmailDisplay = isParticipant
    ? debt.lender?.email
    : maskEmailAddress(debt.lender?.email);
  const borrowerEmailDisplay = isParticipant
    ? debt.borrower?.email
    : maskEmailAddress(debt.borrower?.email);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const participantShareUrl = `${origin}/share?id=${debt.id}&mode=participants`;
  const globalShareUrl =
    shareMeta?.globalEnabled && shareMeta?.globalToken
      ? `${origin}/share?id=${debt.id}&token=${shareMeta.globalToken}`
      : '';

  const copyLink = async (url: string, type: 'participant' | 'global') => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2500);
    } catch (_) {}
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--on-surface)] flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-[var(--surface)]/85 border-b border-[var(--outline-variant)]/20 px-4 md:px-8 py-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/">
            <BrandLogo size="sm" showTagline={false} />
          </Link>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/30 font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--on-surface-variant)]">
            <span className="material-symbols-outlined text-[13px] text-[var(--primary)]">
              receipt_long
            </span>
            <span>Shared Transaction Record</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {currentUser ? (
            <Link
              href={`/transactions?debt=${debt.id}`}
              className="py-2 px-3.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-95 transition-all flex items-center gap-1.5 min-h-[38px]"
            >
              <span className="material-symbols-outlined text-[15px]">open_in_new</span>
              <span>Open in App</span>
            </Link>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(currentRelativeUrl)}`}
              className="py-2 px-3.5 rounded-xl border border-[var(--primary)]/40 text-[var(--primary)] hover:bg-[var(--primary)]/10 font-mono text-xs font-bold transition-all flex items-center gap-1.5 min-h-[38px]"
            >
              <span className="material-symbols-outlined text-[15px]">login</span>
              <span>Participant Sign In</span>
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-3xl mx-auto p-4 md:p-8 space-y-6">
        {/* Access Mode & Privacy Banner */}
        {isParticipant ? (
          <div className="p-4 rounded-2xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-emerald-500 text-[20px] shrink-0 mt-0.5">
                  verified_user
                </span>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-heading font-bold text-xs md:text-sm text-[var(--on-surface)]">
                      Verified Participant View
                    </span>
                    <span className="px-2 py-0.5 rounded-md font-mono text-[9px] font-bold uppercase bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      {isDirectParty ? 'Direct Counterparty' : 'Split Group Member'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">
                    Signed in as <strong>{currentUser?.email}</strong>. You have full participant access to this ledger.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => copyLink(participantShareUrl, 'participant')}
                  className="py-2 px-3 rounded-xl border border-[var(--outline-variant)]/40 hover:bg-[var(--surface-container)] font-mono text-[11px] font-bold text-[var(--on-surface)] flex items-center gap-1.5 cursor-pointer min-h-[38px]"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {copiedType === 'participant' ? 'check' : 'group'}
                  </span>
                  <span>
                    {copiedType === 'participant' ? 'Copied!' : 'Copy Participant Link'}
                  </span>
                </button>
              </div>
            </div>

            {/* Global Link Status & Mutual Kill-Switch for Participants */}
            {shareMeta?.globalEnabled ? (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-amber-500 text-[18px] shrink-0 mt-0.5">
                    public
                  </span>
                  <div>
                    <div className="font-heading font-bold text-xs text-amber-600 dark:text-amber-400">
                      Global Public Link is Currently ON
                    </div>
                    <p className="text-[11px] text-[var(--on-surface-variant)]">
                      Enabled by <strong>{shareMeta.enabledByName || 'a participant'}</strong>. Anyone with the tokenized link can view a read-only summary.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {globalShareUrl && (
                    <button
                      type="button"
                      onClick={() => copyLink(globalShareUrl, 'global')}
                      className="py-1.5 px-2.5 rounded-lg bg-amber-500 text-white font-mono text-[10px] font-bold hover:opacity-95 cursor-pointer min-h-[34px]"
                    >
                      {copiedType === 'global' ? 'Copied!' : 'Copy Public Link'}
                    </button>
                  )}
                  {isDirectParty && (
                    <button
                      type="button"
                      onClick={() => handleToggleGlobalShare('disable')}
                      disabled={shareLoading}
                      className="py-1.5 px-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/25 font-mono text-[10px] font-bold cursor-pointer disabled:opacity-50 min-h-[34px]"
                    >
                      {shareLoading ? 'Disabling...' : 'Turn Off Global Link'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              isDirectParty &&
              debt.status !== 'declined' && (
                <div className="pt-2 border-t border-[var(--outline-variant)]/15 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-[var(--on-surface-variant)] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">lock</span>
                    <span>Global public sharing is OFF (Restricted to participants only)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleGlobalShare('enable')}
                    disabled={shareLoading}
                    className="py-1.5 px-3 rounded-lg border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 font-mono text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50 self-start sm:self-auto min-h-[34px]"
                  >
                    <span className="material-symbols-outlined text-[13px]">public</span>
                    <span>{shareLoading ? 'Enabling...' : 'Enable Global Link'}</span>
                  </button>
                </div>
              )
            )}

            {feedbackMessage && (
              <div
                className={`p-2.5 rounded-lg font-mono text-[11px] ${
                  feedbackMessage.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                    : feedbackMessage.type === 'error'
                    ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                    : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] border border-[var(--outline-variant)]/30'
                }`}
              >
                {feedbackMessage.text}
              </div>
            )}
          </div>
        ) : (
          /* Public Global Viewer Banner */
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="material-symbols-outlined text-amber-500 text-[20px] shrink-0 mt-0.5">
                public
              </span>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-heading font-bold text-xs md:text-sm text-amber-600 dark:text-amber-400">
                    Public Shared Transaction (Read-Only)
                  </span>
                  <span className="px-2 py-0.5 rounded-md font-mono text-[9px] font-bold uppercase bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    Global View Active
                  </span>
                </div>
                <p className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">
                  Shared publicly by <strong>{shareMeta?.enabledByName || 'a transaction participant'}</strong>. Personal email addresses are masked for privacy.
                </p>
              </div>
            </div>
            <Link
              href={`/login?next=${encodeURIComponent(currentRelativeUrl)}`}
              className="py-2 px-3 rounded-xl bg-[var(--surface-container-lowest)] border border-amber-500/30 font-mono text-[11px] font-bold text-[var(--on-surface)] hover:bg-[var(--surface-container)] shrink-0 self-start sm:self-center min-h-[38px] flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[14px] text-amber-500">
                manage_accounts
              </span>
              <span>Participant? Sign in to manage</span>
            </Link>
          </div>
        )}

        {/* Main Transaction Card */}
        <div className="bg-[var(--surface-container-lowest)] rounded-2xl border border-[var(--outline-variant)]/30 shadow-xl p-5 md:p-7 space-y-6">
          {/* Header & Status */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--outline-variant)]/20">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--on-surface-variant)] font-semibold">
                Debt Agreement &amp; Audit Ledger
              </div>
              <h1 className="font-heading text-lg md:text-xl font-bold text-[var(--on-surface)] mt-0.5">
                {splitDetails
                  ? `Split Bill: ${splitDetails.title}`
                  : 'Peer-to-Peer Ledger Agreement'}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2.5 py-1 rounded-md font-mono text-[10px] uppercase font-bold ${
                  debt.status === 'active'
                    ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                    : debt.status === 'pending'
                    ? 'bg-amber-500/10 text-amber-500'
                    : debt.status === 'settled'
                    ? 'bg-emerald-500/10 text-emerald-500'
                    : 'bg-red-500/10 text-red-500'
                }`}
              >
                {debt.status}
              </span>
            </div>
          </div>

          {/* Parties Involved */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/20">
            <div className="flex items-center gap-3">
              <Avatar src={debt.lender?.avatar_url} name={lenderName} size="md" />
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--primary)] font-bold">
                  Lender (Creditor)
                </div>
                <div className="font-heading font-bold text-sm text-[var(--on-surface)] truncate">
                  {lenderName}
                </div>
                <div className="font-mono text-[11px] text-[var(--on-surface-variant)] truncate">
                  {lenderEmailDisplay}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:border-l border-[var(--outline-variant)]/20 sm:pl-4">
              <Avatar src={debt.borrower?.avatar_url} name={borrowerName} size="md" />
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-wider text-amber-500 font-bold">
                  Borrower (Debtor)
                </div>
                <div className="font-heading font-bold text-sm text-[var(--on-surface)] truncate">
                  {borrowerName}
                </div>
                <div className="font-mono text-[11px] text-[var(--on-surface-variant)] truncate">
                  {borrowerEmailDisplay}
                </div>
              </div>
            </div>
          </div>

          {/* Financial Figures */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-[var(--surface-container)]">
              <div className="font-mono text-[10px] uppercase text-[var(--on-surface-variant)]">
                Principal
              </div>
              <div className="font-numeric-ticker text-base font-bold text-[var(--on-surface)] mt-1">
                {formatCurrency(debt.principal, debtCurrency)}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--surface-container)]">
              <div className="font-mono text-[10px] uppercase text-[var(--on-surface-variant)]">
                Accrued Interest
              </div>
              <div className="font-numeric-ticker text-base font-bold text-[var(--secondary)] mt-1">
                +{formatCurrency(calc.totalAccruedInterest, debtCurrency)}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--surface-container)]">
              <div className="font-mono text-[10px] uppercase text-[var(--on-surface-variant)]">
                Verified Paid
              </div>
              <div className="font-numeric-ticker text-base font-bold text-emerald-500 mt-1">
                -{formatCurrency(calc.totalPaid, debtCurrency)}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/20">
              <div className="font-mono text-[10px] uppercase text-[var(--primary)] font-semibold">
                Remaining Balance
              </div>
              <div className="font-numeric-ticker text-base font-bold text-[var(--primary)] mt-1">
                {formatCurrency(calc.currentBalance, debtCurrency)}
              </div>
            </div>
          </div>

          {/* Terms Metadata */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[var(--on-surface-variant)] px-1">
            <div>
              Interest Terms:{' '}
              <strong className="text-[var(--on-surface)] uppercase">
                {debt.interest_type === 'none'
                  ? '0% (Interest-Free)'
                  : `${debt.interest_rate}% ${debt.interest_type} (${debt.compound_freq || 'monthly'})`}
              </strong>
            </div>
            <div>
              Origination:{' '}
              <strong className="text-[var(--on-surface)]">
                {new Date(debt.created_at).toLocaleDateString()}
              </strong>
            </div>
            {debt.due_date && (
              <div>
                Due Date:{' '}
                <strong className="text-[var(--on-surface)]">
                  {new Date(debt.due_date).toLocaleDateString()}
                </strong>
              </div>
            )}
          </div>

          {/* Split Bill Breakdown (if Split Transaction) */}
          {splitDetails && (
            <div className="p-4 rounded-xl bg-[var(--primary)]/5 border border-[var(--primary)]/20 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/15 flex items-center justify-center text-[var(--primary)]">
                    <span className="material-symbols-outlined text-[18px]">call_split</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-heading font-bold text-xs text-[var(--on-surface)]">
                        {splitDetails.title}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-[var(--primary)]/15 text-[var(--primary)] font-mono text-[9px] font-bold uppercase">
                        {splitDetails.splitMode === 'equal' ? 'Equal Split' : 'Custom Split'}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-[var(--on-surface-variant)]">
                      Split across {splitDetails.participants.length} people
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[9px] uppercase text-[var(--on-surface-variant)]">
                    Total Group Bill
                  </div>
                  <div className="font-numeric-ticker text-sm font-bold text-[var(--primary)]">
                    {formatCurrency(splitDetails.totalAmount, splitDetails.currency || debtCurrency)}
                  </div>
                </div>
              </div>

              {splitDetails.participants && splitDetails.participants.length > 0 && (
                <div className="pt-2 border-t border-[var(--outline-variant)]/15 space-y-1.5">
                  <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--on-surface-variant)]">
                    All Split Participants ({splitDetails.participants.length})
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {splitDetails.participants.map((part, idx) => (
                      <div
                        key={`${part.userId}-${idx}`}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 text-xs"
                      >
                        <div className="flex items-center gap-1.5 truncate pr-2">
                          <span className="material-symbols-outlined text-[13px] text-[var(--primary)]">
                            {part.isPayer ? 'stars' : 'person'}
                          </span>
                          <span className="font-medium text-[var(--on-surface)] truncate">
                            {part.name} {part.isPayer ? '(Payer)' : ''}
                          </span>
                        </div>
                        <span className="font-numeric-ticker font-bold text-[var(--primary)] shrink-0">
                          {formatCurrency(part.shareAmount, splitDetails.currency || debtCurrency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Agreement Notes */}
          <div className="space-y-3">
            <h3 className="font-heading font-bold text-sm text-[var(--on-surface)]">
              Agreement Notes &amp; Context
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/20">
                <div className="font-mono text-[10px] uppercase text-[var(--primary)] font-bold mb-1">
                  Creator&apos;s Note
                </div>
                <p className="text-xs text-[var(--on-surface)] whitespace-pre-wrap">
                  {cleanCreatorNote || (
                    <span className="italic text-[var(--on-surface-variant)]">
                      No note added by creator.
                    </span>
                  )}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/20">
                <div className="font-mono text-[10px] uppercase text-[var(--secondary)] font-bold mb-1">
                  Counterparty&apos;s Note
                </div>
                <p className="text-xs text-[var(--on-surface)] whitespace-pre-wrap">
                  {debt.counterparty_notes || (
                    <span className="italic text-[var(--on-surface-variant)]">
                      No note added by counterparty.
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Repayment History */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-bold text-sm text-[var(--on-surface)]">
                Repayment History &amp; Receipts
              </h3>
              <span className="font-mono text-[10px] text-[var(--on-surface-variant)]">
                {payments.length} record(s)
              </span>
            </div>

            {payments.length === 0 ? (
              <div className="p-4 rounded-xl border border-[var(--outline-variant)]/20 text-center font-mono text-xs text-[var(--on-surface-variant)]">
                No repayments recorded yet.
              </div>
            ) : (
              <div className="space-y-2">
                {payments.map((p) => {
                  const isVerified = p.is_verified !== false;
                  const cleanPaymentNote = getCleanDebtNotes(p.note || p.notes);
                  return (
                    <div
                      key={p.id}
                      className="p-3.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-numeric-ticker font-bold text-sm text-[var(--on-surface)]">
                            {formatCurrency(p.amount, debtCurrency)}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded font-mono text-[9px] uppercase font-bold ${
                              isVerified
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : 'bg-amber-500/10 text-amber-500'
                            }`}
                          >
                            {isVerified ? 'Verified' : 'Pending Verification'}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-[var(--on-surface-variant)]">
                          Paid on {new Date(p.created_at || p.paid_at).toLocaleString()}
                        </div>
                        {cleanPaymentNote && (
                          <p className="text-xs text-[var(--on-surface)] italic">
                            &ldquo;{cleanPaymentNote}&rdquo;
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Chronological Audit Trail */}
          <div className="space-y-3">
            <h3 className="font-heading font-bold text-sm text-[var(--on-surface)]">
              Chronological Audit Trail
            </h3>

            {activityLogs.length === 0 ? (
              <div className="p-4 rounded-xl border border-[var(--outline-variant)]/20 text-center font-mono text-xs text-[var(--on-surface-variant)]">
                No audit events logged yet.
              </div>
            ) : (
              <div className="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--outline-variant)]/30">
                {activityLogs.map((log) => {
                  let dotColor = 'bg-[var(--outline)]';
                  let title = log.action;
                  const actor = (log.details as any)?.actorName || (log.details as any)?.by_name || 'Participant';

                  if (log.action === 'payment_made') {
                    dotColor = 'bg-[var(--secondary)]';
                    title = 'Payment Recorded';
                  } else if (log.action === 'repayment_reported') {
                    dotColor = 'bg-amber-500';
                    title = 'Repayment Reported';
                  } else if (log.action === 'payment_verified') {
                    dotColor = 'bg-emerald-500';
                    title = 'Repayment Verified by Lender';
                  } else if (log.action === 'payment_disputed') {
                    dotColor = 'bg-red-500';
                    title = 'Repayment Disputed by Lender';
                  } else if (log.action === 'creator_note_updated') {
                    dotColor = 'bg-[var(--primary)]';
                    title = 'Creator Note Updated';
                  } else if (log.action === 'counterparty_note_updated') {
                    dotColor = 'bg-[var(--secondary)]';
                    title = 'Counterparty Note Updated';
                  } else if (log.action === 'debt_created') {
                    dotColor = 'bg-[var(--primary)]';
                    title = 'Debt Agreement Created';
                  } else if (log.action === 'debt_pending_edited') {
                    dotColor = 'bg-amber-500';
                    title = 'Pending Agreement Edited';
                  } else if (log.action === 'debt_accepted') {
                    dotColor = 'bg-emerald-500';
                    title = 'Agreement Accepted by Counterparty';
                  } else if (log.action === 'debt_declined') {
                    dotColor = 'bg-red-500';
                    title = 'Agreement Declined by Counterparty';
                  } else if (log.action === 'debt_settled') {
                    dotColor = 'bg-emerald-500';
                    title = 'Debt Agreement Fully Settled';
                  } else if (log.action === 'global_share_enabled') {
                    dotColor = 'bg-amber-500';
                    title = `Global Public Link Enabled by ${actor}`;
                  } else if (log.action === 'global_share_disabled') {
                    dotColor = 'bg-[var(--outline)]';
                    title = `Global Public Link Disabled by ${actor}`;
                  } else if (log.action === 'global_share_regenerated') {
                    dotColor = 'bg-amber-500';
                    title = `Global Public Link Rotated by ${actor}`;
                  }

                  return (
                    <div key={log.id} className="relative">
                      <div
                        className={`absolute -left-[23px] top-1 w-2.5 h-2.5 rounded-full ${dotColor} ring-4 ring-[var(--surface-container-lowest)]`}
                      />
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <div className="font-heading font-semibold text-xs text-[var(--on-surface)]">
                          {title}
                        </div>
                        <div className="font-mono text-[10px] text-[var(--on-surface-variant)]">
                          {new Date(log.created_at).toLocaleString()}
                        </div>
                      </div>
                      {log.details && (log.details as any).note && (
                        <p className="text-xs text-[var(--on-surface-variant)] mt-0.5">
                          {(log.details as any).note}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ShareTransactionPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--surface)] flex items-center justify-center">
          <div className="font-mono text-xs text-[var(--on-surface-variant)]">
            Loading shared transaction...
          </div>
        </div>
      }
    >
      <ShareTransactionContent />
    </Suspense>
  );
}
