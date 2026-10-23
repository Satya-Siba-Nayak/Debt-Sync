'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance, calculatePortfolioAccrualRates, round2, sortDebtsActiveFirst, isDebtPurgedByAdmin } from '@/lib/utils/interest';
import { BalanceCards } from '@/components/dashboard/BalanceCards';
import { LiveTicker } from '@/components/dashboard/LiveTicker';
import { CashflowChart } from '@/components/dashboard/CashflowChart';
import { formatCurrency } from '@/lib/utils/currency';
import { Chip } from '@/components/ui/Chip';
import { Avatar } from '@/components/ui/Avatar';
import { claimUserProfile } from '@/lib/utils/claim-profile';
import { getDueDateInfo } from '@/lib/utils/due-date';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { getLedgerCache, setLedgerCache, computeDashboardStats } from '@/lib/stores/ledger-store';
import { SkeletonBalanceCards, SkeletonTableRows } from '@/components/ui/Skeleton';
import { parseSplitDetails, parseShareMetadata, getCleanDebtNotes } from '@/lib/utils/split-bills';
import { EditPendingDebtModal } from '@/components/debts/EditPendingDebtModal';
import { DebtDetailModal } from '@/components/debts/DebtDetailModal';
import { respondToDebtAgreement, cancelPendingDebt } from '@/lib/utils/debt-acceptance';
import Link from 'next/link';

export default function GlobalDashboardPage() {
  const supabase = createClient();

  const initialCache = getLedgerCache();
  const [loading, setLoading] = useState(!initialCache);
  const [currency, setCurrency] = useState(initialCache?.currency || 'inr');
  const [debts, setDebts] = useState<Debt[]>(initialCache?.debts || []);
  const [payments, setPayments] = useState<Payment[]>(initialCache?.payments || []);
  const [currentUserId, setCurrentUserId] = useState<string | null>(initialCache?.userId || null);
  const [selectedDebtForEdit, setSelectedDebtForEdit] = useState<Debt | null>(null);
  const [selectedDebtForDetail, setSelectedDebtForDetail] = useState<Debt | null>(null);
  const [showFlowGuide, setShowFlowGuide] = useState(false);
  const [hasCompletedFetch, setHasCompletedFetch] = useState(Boolean(initialCache));
  const [isFlowGuideDismissed, setIsFlowGuideDismissed] = useState<boolean>(true);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem('debtsync_flow_guide_dismissed') === 'true';
      setIsFlowGuideDismissed(dismissed);
    } catch {}
  }, []);

  const toggleFlowGuide = (next: boolean) => {
    setShowFlowGuide(next);
    setIsFlowGuideDismissed(!next);
    try {
      if (!next) localStorage.setItem('debtsync_flow_guide_dismissed', 'true');
      else localStorage.removeItem('debtsync_flow_guide_dismissed');
    } catch {}
  };

  const initialStats = initialCache && initialCache.userId
    ? computeDashboardStats(initialCache.debts, initialCache.payments, initialCache.userId)
    : null;

  // Portfolio Totals
  const [netPosition, setNetPosition] = useState(initialStats?.netPosition ?? 0);
  const [totalLent, setTotalLent] = useState(initialStats?.totalLent ?? 0);
  const [totalOwed, setTotalOwed] = useState(initialStats?.totalOwed ?? 0);
  const [activeLentCount, setActiveLentCount] = useState(initialStats?.activeLentCount ?? 0);
  const [activeOwedCount, setActiveOwedCount] = useState(initialStats?.activeOwedCount ?? 0);
  const [totalInterestAccrued, setTotalInterestAccrued] = useState(initialStats?.totalInterestAccrued ?? 0);
  const [borrowingInterestAccrued, setBorrowingInterestAccrued] = useState(initialStats?.borrowingInterestAccrued ?? 0);
  const [dailyAccrualRate, setDailyAccrualRate] = useState(initialStats?.dailyAccrualRate ?? 0);
  const isFetchingDashboardRef = useRef(false);

  const fetchDashboardData = useCallback(async () => {
    if (isFetchingDashboardRef.current) return;
    isFetchingDashboardRef.current = true;
    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) return;
      setCurrentUserId(user.id);

      // Run profile claim, user settings, and debts fetch concurrently
      const [, settingsRes, debtRecordsRes] = await Promise.all([
        claimUserProfile(user),
        supabase
          .from('user_settings')
          .select('default_currency')
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('debts')
          .select(`
            *,
            lender:profiles!debts_lender_id_fkey(id, email, full_name, avatar_url),
            borrower:profiles!debts_borrower_id_fkey(id, email, full_name, avatar_url)
          `)
          .or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`)
          .order('created_at', { ascending: false }),
      ]);

      const activeCurrency = settingsRes.data?.default_currency || 'inr';
      if (settingsRes.data?.default_currency) {
        setCurrency(settingsRes.data.default_currency);
      }

      const allDebts: Debt[] = (debtRecordsRes.data as any) || [];
      const debtIds = allDebts.map((d) => d.id);
      let allPayments: Payment[] = [];

      if (debtIds.length > 0) {
        const { data: paymentRecords } = await supabase
          .from('payments')
          .select('*')
          .in('debt_id', debtIds);
        allPayments = (paymentRecords as any) || [];

        // Only purge unverified payments on settled debts if any actually exist
        const settledDebtIdSet = new Set(allDebts.filter((d) => d.status === 'settled').map((d) => d.id));
        const hasOrphanedUnverified = allPayments.some(
          (p) => !p.is_verified && settledDebtIdSet.has(p.debt_id)
        );
        if (hasOrphanedUnverified) {
          supabase
            .from('payments')
            .delete()
            .in('debt_id', Array.from(settledDebtIdSet))
            .eq('is_verified', false)
            .then(() => {});
        }
      }

      setDebts(allDebts);
      setPayments(allPayments);
      setHasCompletedFetch(true);

      // Compute calculations instantly via shared utility
      const stats = computeDashboardStats(allDebts, allPayments, user.id);
      setTotalLent(stats.totalLent);
      setTotalOwed(stats.totalOwed);
      setNetPosition(stats.netPosition);
      setActiveLentCount(stats.activeLentCount);
      setActiveOwedCount(stats.activeOwedCount);
      setTotalInterestAccrued(stats.totalInterestAccrued);
      setBorrowingInterestAccrued(stats.borrowingInterestAccrued);
      setDailyAccrualRate(stats.dailyAccrualRate);

      // Extract unique counterparties to prime the recipient cache for new transactions
      const peopleMap = new Map<string, any>();
      for (const d of allDebts) {
        const isLender = d.lender_id === user.id;
        const otherParty = isLender ? d.borrower : d.lender;
        if (otherParty && otherParty.id && !peopleMap.has(otherParty.id)) {
          peopleMap.set(otherParty.id, {
            id: otherParty.id,
            name: otherParty.full_name || otherParty.email,
            email: otherParty.email,
            phone: (otherParty as any).phone || null,
            avatar_url: otherParty.avatar_url,
          });
        }
      }

      // Update hot client cache
      setLedgerCache({
        userId: user.id,
        debts: allDebts,
        payments: allPayments,
        people: peopleMap.size > 0 ? Array.from(peopleMap.values()) : undefined,
        currency: activeCurrency,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
      isFetchingDashboardRef.current = false;
    }
  }, [supabase]);

  const handleAcceptDebt = async (debtId: string, decision: 'active' | 'declined') => {
    try {
      await respondToDebtAgreement(supabase, debtId, decision);
      fetchDashboardData();
    } catch (err: any) {
      console.error('Error updating debt:', err);
      alert(err.message || 'Failed to update debt agreement');
    }
  };

  const handleTakeBackPendingDebt = async (debtId: string) => {
    if (
      !confirm(
        'Are you sure you want to take back this pending agreement? This will cancel the transaction request before counterparty acceptance.'
      )
    ) {
      return;
    }
    try {
      await cancelPendingDebt(supabase, debtId);
      fetchDashboardData();
    } catch (err: any) {
      console.error('Error taking back pending debt:', err);
      alert(err.message || 'Failed to take back pending agreement');
    }
  };

  useEffect(() => {
    fetchDashboardData();

    // 1. Local custom event listener
    const handleRefresh = () => fetchDashboardData();
    window.addEventListener('debtsync:refresh', handleRefresh);

    // 2. Supabase Realtime channel for instant multi-device sync
    const channel = supabase
      .channel('dashboard-realtime-debts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'debts' }, () => {
        fetchDashboardData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchDashboardData();
      })
      .subscribe();

    return () => {
      window.removeEventListener('debtsync:refresh', handleRefresh);
      supabase.removeChannel(channel);
    };
  }, [fetchDashboardData, supabase]);

  const visibleDebts = React.useMemo(
    () => debts.filter((d) => !d.hidden_by?.includes(currentUserId || '')),
    [debts, currentUserId]
  );

  const incomingPendingDebts = visibleDebts.filter(
    (d) => d.status === 'pending' && d.created_by !== currentUserId && !isDebtPurgedByAdmin(d)
  );

  const debtsWithUnverifiedRepayments = React.useMemo(() => {
    if (!currentUserId) return [];
    return visibleDebts
      .filter((d) => d.status === 'active' && d.lender_id === currentUserId && !isDebtPurgedByAdmin(d))
      .map((d) => {
        const unverified = payments.filter(
          (p) =>
            p.debt_id === d.id &&
            !p.is_verified &&
            !(typeof p.note === 'string' && p.note.includes('[DISPUTED]'))
        );
        return { debt: d, unverifiedPayments: unverified };
      })
      .filter((item) => item.unverifiedPayments.length > 0);
  }, [visibleDebts, payments, currentUserId]);

  const sortedDebts = React.useMemo(() => sortDebtsActiveFirst(visibleDebts), [visibleDebts]);
  const shouldDisplayFlowGuide =
    showFlowGuide || (hasCompletedFetch && !loading && !isFlowGuideDismissed && debts.length === 0);

  return (
    <div className="page-enter flex flex-col gap-6 md:gap-8">
      {/* Incoming Agreements Awaiting Acceptance Alert */}
      {incomingPendingDebts.length > 0 && (
        <section className="bg-amber-500/10 border border-amber-500/30 dark:bg-amber-950/20 rounded-2xl p-5 md:p-6 space-y-4 animate-in fade-in duration-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold text-sm">
              <span className="material-symbols-outlined text-[20px]">notifications_active</span>
              <span>Incoming Agreement Awaiting Your Approval</span>
            </div>
            <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300">
              {incomingPendingDebts.length} Pending
            </span>
          </div>

          <div className="space-y-3">
            {incomingPendingDebts.map((d) => {
              const isLender = d.lender_id === currentUserId;
              const counterparty = isLender ? d.borrower : d.lender;
              const name = counterparty?.full_name || counterparty?.email || 'Counterparty';
              const split = parseSplitDetails(d);
              const cleanNotes = getCleanDebtNotes(d.notes);
              const otherParticipants = split?.participants.filter((p) => p.userId !== currentUserId) || [];

              return (
                <div
                  key={d.id}
                  onClick={() => setSelectedDebtForDetail(d)}
                  className="bg-[var(--surface-container-lowest)] hover:bg-[var(--surface-container-low)] p-4 rounded-xl border border-[var(--outline-variant)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs transition-colors cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <Avatar src={counterparty?.avatar_url} name={name} size="md" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="font-heading font-bold text-sm text-[var(--on-surface)]">
                          {name}
                        </span>
                        {split ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">call_split</span>
                            <span>Split Bill: {split.title}</span>
                          </span>
                        ) : (
                          <span className="font-normal text-xs text-[var(--on-surface-variant)]">recorded a transaction:</span>
                        )}
                      </div>

                      <div className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
                        {isLender ? 'You Lent' : 'You Borrowed'}: <strong className="text-[var(--on-surface)] text-sm">{formatCurrency(d.principal, d.currency || currency)}</strong>
                        {split && (
                          <span className="text-[var(--primary)] font-semibold ml-1.5">
                            (Total Bill: {formatCurrency(split.totalAmount, split.currency)} split between {split.participants.length} people)
                          </span>
                        )}
                        {d.interest_type && d.interest_type !== 'none' && d.interest_rate ? (
                          <>
                            {' '}&bull;{' '}
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">
                              {d.interest_rate}% {d.interest_type} APR
                            </span>
                          </>
                        ) : !split ? (
                          <>
                            {' '}&bull;{' '}
                            {d.interest_type === 'none' ? '0% Interest-Free' : `${d.interest_rate}% ${d.interest_type}`}
                          </>
                        ) : null}
                        {cleanNotes ? ` &bull; "${cleanNotes}"` : ''}
                      </div>

                      {split && otherParticipants.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px] font-mono text-[var(--on-surface-variant)]">
                          <span className="text-[var(--outline)]">Split with:</span>
                          {split.participants.map((pt) => (
                            <span
                              key={pt.userId}
                              className={`px-1.5 py-0.5 rounded text-[10px] ${
                                pt.userId === currentUserId
                                  ? 'bg-[var(--primary)]/15 text-[var(--primary)] font-bold'
                                  : pt.isPayer
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium'
                                  : 'bg-[var(--surface-container-high)] text-[var(--on-surface)]'
                              }`}
                            >
                              {pt.name} {pt.userId === currentUserId ? '(You)' : pt.isPayer ? '(Paid)' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-2 self-end sm:self-auto flex-wrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => handleAcceptDebt(d.id, 'declined')}
                      className="px-3.5 py-1.5 rounded-xl border border-error/30 text-error font-mono text-xs font-bold hover:bg-error/10 transition-colors cursor-pointer"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => handleAcceptDebt(d.id, 'active')}
                      className="px-4 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-xs flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">check</span>
                      <span>Accept Agreement</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Repayments Awaiting Lender Verification Alert */}
      {debtsWithUnverifiedRepayments.length > 0 && (
        <section className="bg-emerald-500/10 border border-emerald-500/30 dark:bg-emerald-950/20 rounded-2xl p-5 md:p-6 space-y-3.5 animate-in fade-in duration-300">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
              <span className="material-symbols-outlined text-[20px]">verified</span>
              <span>Repayments Awaiting Your Verification</span>
            </div>
            <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-800 dark:text-emerald-300">
              {debtsWithUnverifiedRepayments.reduce((acc, item) => acc + item.unverifiedPayments.length, 0)} Payment(s) Logged
            </span>
          </div>
          <p className="text-xs font-mono text-[var(--on-surface-variant)]">
            A borrower logged a repayment toward your loan. Confirm receipt in your bank/UPI app and verify below to deduct the balance.
          </p>

          <div className="space-y-2.5">
            {debtsWithUnverifiedRepayments.map(({ debt: d, unverifiedPayments }) => {
              const borrower = d.borrower;
              const name = borrower?.full_name || borrower?.email || 'Borrower';
              const totalClaimed = unverifiedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
              const latestPayment = unverifiedPayments[0];

              return (
                <div
                  key={d.id}
                  onClick={() => setSelectedDebtForDetail(d)}
                  className="bg-[var(--surface-container-lowest)] hover:bg-[var(--surface-container-low)] p-4 rounded-xl border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <Avatar src={borrower?.avatar_url} name={name} size="md" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-heading font-bold text-sm text-[var(--on-surface)]">{name}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                          Sent {formatCurrency(totalClaimed, d.currency || currency)}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
                        Original Loan: {formatCurrency(d.principal, d.currency || currency)}
                        {latestPayment?.note ? ` • Note: "${latestPayment.note}"` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setSelectedDebtForDetail(d)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">fact_check</span>
                      <span>Review &amp; Verify</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Interactive 4-Stage Bilateral Workflow Guide */}
      {shouldDisplayFlowGuide && (
        <section className="bg-[var(--surface-container-lowest)] rounded-2xl p-5 md:p-6 border border-[var(--primary)]/25 shadow-xs relative overflow-hidden">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/15 text-[var(--primary)] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[18px]">route</span>
              </div>
              <div>
                <h3 className="font-heading text-sm md:text-base font-bold text-[var(--on-surface)]">
                  How DebtSync Bilateral Ledger Works
                </h3>
                <p className="font-mono text-[11px] text-[var(--on-surface-variant)]">
                  Zero-dispute peer-to-peer agreements in 4 transparent steps
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => toggleFlowGuide(false)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-mono text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container)] transition-colors flex items-center gap-1 cursor-pointer shrink-0"
              title="Dismiss workflow guide"
            >
              <span>Got it</span>
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-[var(--surface-container-low)]/70 border border-[var(--outline-variant)]/20 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  STEP 1 • PROPOSE
                </span>
                <span className="material-symbols-outlined text-[18px] text-amber-500">post_add</span>
              </div>
              <p className="font-heading font-bold text-xs text-[var(--on-surface)] mt-0.5">
                Log Loan or Split Bill
              </p>
              <p className="font-mono text-[11px] text-[var(--on-surface-variant)] leading-relaxed">
                Tap <strong>+ New Transaction</strong> to record a loan, borrowing, or multi-person split bill. It starts as <strong>Pending</strong>.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--surface-container-low)]/70 border border-[var(--outline-variant)]/20 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/15 text-blue-600 dark:text-blue-400">
                  STEP 2 • BILATERAL LOCK
                </span>
                <span className="material-symbols-outlined text-[18px] text-blue-500">handshake</span>
              </div>
              <p className="font-heading font-bold text-xs text-[var(--on-surface)] mt-0.5">
                Counterparty Accepts
              </p>
              <p className="font-mono text-[11px] text-[var(--on-surface-variant)] leading-relaxed">
                The other party reviews and clicks <strong>Accept</strong>. Once accepted, terms lock in as <strong>Active</strong> and cannot be unilaterally altered.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--surface-container-low)]/70 border border-[var(--outline-variant)]/20 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/15 text-purple-600 dark:text-purple-400">
                  STEP 3 • REPAY
                </span>
                <span className="material-symbols-outlined text-[18px] text-purple-500">qr_code_2</span>
              </div>
              <p className="font-heading font-bold text-xs text-[var(--on-surface)] mt-0.5">
                Pay via Direct UPI or Cash
              </p>
              <p className="font-mono text-[11px] text-[var(--on-surface-variant)] leading-relaxed">
                Borrower pays directly to the lender&apos;s UPI ID / QR code (0% platform fees) and logs the repayment in the ledger.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--surface-container-low)]/70 border border-[var(--outline-variant)]/20 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  STEP 4 • VERIFY &amp; SETTLE
                </span>
                <span className="material-symbols-outlined text-[18px] text-emerald-500">verified</span>
              </div>
              <p className="font-heading font-bold text-xs text-[var(--on-surface)] mt-0.5">
                Lender Verifies Receipt
              </p>
              <p className="font-mono text-[11px] text-[var(--on-surface-variant)] leading-relaxed">
                Lender confirms bank receipt with 1 click. The balance updates automatically and marks the contract <strong>Settled</strong> at ₹0.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 1. Top Bento Summary Grid */}
      {loading && debts.length === 0 ? (
        <SkeletonBalanceCards />
      ) : (
        <BalanceCards
          netPosition={netPosition}
          totalLent={totalLent}
          totalOwed={totalOwed}
          activeLentCount={activeLentCount}
          activeOwedCount={activeOwedCount}
          currency={currency}
          monthlyGrowth={dailyAccrualRate * 30}
          totalInterestAccrued={totalInterestAccrued}
          borrowingInterestAccrued={borrowingInterestAccrued}
        />
      )}

      {/* 2. Middle Row: Cashflow Trend Chart & Live Accrual Ticker */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <CashflowChart
            debts={debts}
            payments={payments}
            currentUserId={currentUserId}
            currency={currency}
          />
        </div>

        <div className="lg:col-span-1">
          <LiveTicker
            totalInterestAccrued={totalInterestAccrued}
            dailyRate={dailyAccrualRate}
            currency={currency}
            lendingInterestTotal={totalInterestAccrued}
            borrowingInterestTotal={borrowingInterestAccrued}
          />
        </div>
      </section>

      {/* 3. Recent Activity & Active Ledgers Overview */}
      <section className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-2">
          <div>
            <h3 className="font-heading text-lg md:text-xl font-bold text-[var(--on-surface)]">
              Active Transactions
            </h3>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
              Recent micro-loans and peer obligations — click any row to inspect, repay, or send reminders
            </p>
          </div>

          <div className="flex items-center gap-3">
            {!shouldDisplayFlowGuide && (
              <button
                type="button"
                onClick={() => toggleFlowGuide(true)}
                className="px-2.5 py-1 rounded-lg border border-[var(--outline-variant)]/30 text-[11px] font-mono font-bold text-[var(--on-surface-variant)] hover:text-[var(--primary)] hover:border-[var(--primary)]/40 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">help</span>
                <span>How It Works</span>
              </button>
            )}
            <Link
              href="/transactions"
              className="text-xs font-mono font-bold text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] hover:underline flex items-center gap-1"
            >
              <span>View All</span>
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </Link>
          </div>
        </div>

        {loading && debts.length === 0 ? (
          <SkeletonTableRows rows={5} />
        ) : debts.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--surface-container)] flex items-center justify-center mx-auto mb-3 text-[var(--on-surface-variant)]">
              <span className="material-symbols-outlined text-2xl">receipt_long</span>
            </div>
            <p className="font-heading font-medium text-sm text-[var(--on-surface)]">
              No active debts recorded yet
            </p>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-1">
              Record a peer-to-peer loan or split a group expense to get started
            </p>
            <div className="mt-4 flex items-center justify-center gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('debtsync:open_record_modal'))}
                className="px-4 py-2 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>New Transaction</span>
              </button>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('debtsync:open_split_modal'))}
                className="px-4 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] font-mono text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">call_split</span>
                <span>Split a Bill</span>
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Mobile Card List (< md screens) */}
            <div className="md:hidden max-h-[480px] overflow-y-auto overscroll-contain modal-scroll-container pr-1 space-y-3">
              {sortedDebts.slice(0, 8).map((d) => {
                const isLender = d.lender_id === currentUserId;
                const otherPerson = isLender ? d.borrower : d.lender;
                const isPurged = isDebtPurgedByAdmin(d);
                const name = otherPerson?.full_name || otherPerson?.email || (isPurged ? 'Purged Account' : 'Unknown');
                const debtPayments = payments.filter((p) => p.debt_id === d.id);
                const unverifiedCount = debtPayments.filter(
                  (p) => !p.is_verified && !(typeof p.note === 'string' && p.note.includes('[DISPUTED]'))
                ).length;
                const calc = calculateDebtBalance(d, debtPayments);
                const dueDateInfo = getDueDateInfo(d.due_date, d.status);
                const split = parseSplitDetails(d);
                const shareMeta = parseShareMetadata(d.notes);
                const cleanNotes = getCleanDebtNotes(d.notes);

                return (
                  <div
                    key={d.id}
                    onClick={() => setSelectedDebtForDetail(d)}
                    className={`block p-4 rounded-xl border transition-all shadow-xs cursor-pointer ${
                      isPurged
                        ? 'bg-red-500/5 border-red-500/30 hover:bg-red-500/10'
                        : d.status === 'declined'
                        ? 'bg-[var(--surface-container-low)]/40 border-red-500/20 opacity-85'
                        : 'bg-[var(--surface-container-low)]/70 hover:bg-[var(--surface-container-high)]/70 border-[var(--outline-variant)]/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/directory/detail?id=${otherPerson?.id || d.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-3 min-w-0 hover:opacity-90 group"
                      >
                        <Avatar
                          src={otherPerson?.avatar_url}
                          name={name}
                          size="md"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-[var(--on-surface)] group-hover:text-[var(--primary)] group-hover:underline truncate flex items-center gap-1.5 flex-wrap">
                            <span className="truncate">{name}</span>
                            {isPurged && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 flex items-center gap-0.5 shrink-0"
                                title="Transaction purged by administrator"
                              >
                                <span className="material-symbols-outlined text-[10px]">admin_panel_settings</span>
                                <span>(Transaction purged by admin)</span>
                              </span>
                            )}
                            {split && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/20 flex items-center gap-0.5 shrink-0">
                                <span className="material-symbols-outlined text-[10px]">call_split</span>
                                <span>{split.title}</span>
                              </span>
                            )}
                            {shareMeta?.globalEnabled && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[9px] font-mono text-[var(--on-surface-variant)] bg-[var(--surface-container-high)]/70 border border-[var(--outline-variant)]/25 flex items-center gap-0.5 shrink-0"
                                title="Global public link enabled"
                              >
                                <span className="material-symbols-outlined text-[10px]">public</span>
                                <span>Public</span>
                              </span>
                            )}
                          </div>
                          <p className="font-mono text-xs text-[var(--on-surface-variant)] truncate">
                            {otherPerson?.email}
                          </p>
                        </div>
                      </Link>
                      <div className="flex flex-col items-end gap-1">
                        <Chip
                          label={isPurged ? 'purged' : d.status}
                          variant={
                            isPurged
                              ? 'purged'
                              : d.status === 'active'
                              ? 'active'
                              : d.status === 'settled'
                              ? 'settled'
                              : d.status === 'pending'
                              ? 'pending'
                              : d.status === 'declined'
                              ? 'declined'
                              : 'default'
                          }
                          icon={isPurged ? 'admin_panel_settings' : undefined}
                        />
                        {dueDateInfo && d.status !== 'declined' && !isPurged && (
                          <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-semibold border ${dueDateInfo.className} flex items-center gap-1`}>
                            <span className="material-symbols-outlined text-[11px]">
                              {dueDateInfo.isOverdue ? 'warning' : 'event'}
                            </span>
                            {dueDateInfo.text}
                          </span>
                        )}
                        {unverifiedCount > 0 && d.status === 'active' && !isPurged && (
                          <span
                            className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold border flex items-center gap-1 ${
                              isLender
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 animate-pulse'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[11px]">
                              {isLender ? 'fact_check' : 'hourglass_top'}
                            </span>
                            <span>{isLender ? 'Verify Payment' : 'Payment Pending Check'}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-[var(--outline-variant)]/15 flex items-center justify-between">
                      <div>
                        {isPurged ? (
                          <span className="font-mono text-xs font-bold inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                            <span className="material-symbols-outlined text-[14px]">admin_panel_settings</span>
                            (Transaction purged by admin)
                          </span>
                        ) : d.status === 'declined' ? (
                          <span className="font-mono text-xs font-bold inline-flex items-center gap-1 text-red-500 dark:text-red-400">
                            <span className="material-symbols-outlined text-[14px]">block</span>
                            Declined
                          </span>
                        ) : (
                          <span
                            className={`font-mono text-xs font-bold inline-flex items-center gap-1 ${
                              isLender ? 'text-[var(--secondary)]' : 'text-[var(--error)]'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {isLender ? 'arrow_upward' : 'arrow_downward'}
                            </span>
                            {isLender ? 'You Lent' : 'You Borrowed'}
                          </span>
                        )}
                        <div className="font-mono text-[11px] text-[var(--on-surface-variant)] mt-0.5 flex items-center gap-1.5 flex-wrap">
                          {split && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/20 flex items-center gap-0.5">
                              <span className="material-symbols-outlined text-[10px]">call_split</span>
                              <span>Split: {split.title}</span>
                            </span>
                          )}
                          <span>
                            {d.status === 'declined' || isPurged ? (
                              <span className="line-through">{formatCurrency(d.principal, d.currency || currency)}</span>
                            ) : (
                              formatCurrency(d.principal, d.currency || currency)
                            )} • {d.interest_type === 'none' ? '0% Free' : `${d.interest_rate}% ${d.interest_type}`}
                            {cleanNotes ? ` • "${cleanNotes}"` : ''}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-mono text-xs text-[var(--on-surface-variant)] block">
                          Remaining
                        </span>
                        <span className="font-mono font-bold text-base text-[var(--on-surface)]">
                          {isPurged ? (
                            <span className="text-red-500/80 dark:text-red-400/80 line-through text-xs font-mono">
                              Purged
                            </span>
                          ) : d.status === 'declined' ? (
                            <span className="text-red-500/80 dark:text-red-400/80 line-through text-xs font-mono">
                              Void
                            </span>
                          ) : (
                            formatCurrency(calc.currentBalance, d.currency || currency, { showDecimals: true })
                          )}
                        </span>
                      </div>
                    </div>

                    {isPurged && (
                      <div
                        className="mt-3 pt-2.5 border-t border-red-500/20 flex items-center justify-between gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-[11px] font-mono text-red-500 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]">help</span>
                          <span>Purged balance inquiry</span>
                        </span>
                        <a
                          href={`mailto:support@satya-nayak.dev?subject=Support%20Inquiry%20-%20Purged%20Transaction%20${d.id}`}
                          className="px-3 py-1 rounded-lg border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 font-mono text-xs font-bold flex items-center gap-1 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[13px]">mail</span>
                          <span>Support</span>
                        </a>
                      </div>
                    )}

                    {d.status === 'pending' && d.created_by !== currentUserId && (
                      <div
                        className="mt-3 pt-2.5 border-t border-[var(--outline-variant)]/15 flex items-center justify-end gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => handleAcceptDebt(d.id, 'declined')}
                          className="px-3 py-1 rounded-lg border border-error/30 text-error font-mono text-xs font-bold hover:bg-error/10 cursor-pointer"
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => handleAcceptDebt(d.id, 'active')}
                          className="px-3.5 py-1 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 shadow-xs cursor-pointer"
                        >
                          Accept
                        </button>
                      </div>
                    )}

                    {d.status === 'pending' && d.created_by === currentUserId && (
                      <div
                        className="mt-3 pt-2.5 border-t border-[var(--outline-variant)]/15 flex items-center justify-between gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-[11px] font-mono text-amber-500/90 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]">schedule</span>
                          <span>Awaiting acceptance</span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleTakeBackPendingDebt(d.id)}
                            className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/25 font-mono text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                            title="Take back and cancel this pending transaction"
                          >
                            <span className="material-symbols-outlined text-[13px]">undo</span>
                            <span>Take Back</span>
                          </button>
                          <button
                            onClick={() => setSelectedDebtForEdit(d)}
                            className="px-3 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/30 font-mono text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[13px]">edit</span>
                            <span>Edit</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop Table (>= md screens) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse font-body-md text-sm">
                <thead>
                  <tr className="border-b border-[var(--outline-variant)]/20 text-xs font-mono text-[var(--on-surface-variant)] uppercase tracking-wider">
                    <th className="pb-3 font-semibold">Counterparty</th>
                    <th className="pb-3 font-semibold">Role</th>
                    <th className="pb-3 font-semibold">Interest Terms</th>
                    <th className="pb-3 font-semibold">Balance</th>
                    <th className="pb-3 font-semibold">Status</th>
                    <th className="pb-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--outline-variant)]/10">
                  {sortedDebts.slice(0, 8).map((d) => {
                    const isLender = d.lender_id === currentUserId;
                    const otherPerson = isLender ? d.borrower : d.lender;
                    const isPurged = isDebtPurgedByAdmin(d);
                    const name = otherPerson?.full_name || otherPerson?.email || (isPurged ? 'Purged Account' : 'Unknown');
                    const debtPayments = payments.filter((p) => p.debt_id === d.id);
                    const unverifiedCount = debtPayments.filter(
                      (p) => !p.is_verified && !(typeof p.note === 'string' && p.note.includes('[DISPUTED]'))
                    ).length;
                    const calc = calculateDebtBalance(d, debtPayments);
                    const dueDateInfo = getDueDateInfo(d.due_date, d.status);
                    const split = parseSplitDetails(d);
                    const shareMeta = parseShareMetadata(d.notes);
                    const cleanNotes = getCleanDebtNotes(d.notes);

                    return (
                      <tr
                        key={d.id}
                        onClick={() => setSelectedDebtForDetail(d)}
                        className={`transition-colors cursor-pointer ${
                          isPurged
                            ? 'bg-red-500/5 hover:bg-red-500/10'
                            : d.status === 'declined'
                            ? 'bg-red-500/5 hover:bg-red-500/10 opacity-80'
                            : 'hover:bg-[var(--surface-container-low)]/50'
                        }`}
                      >
                        <td className="py-4">
                          <Link
                            href={`/directory/detail?id=${otherPerson?.id || d.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-3 hover:opacity-90 group cursor-pointer"
                            title={`View ${name}'s contact ledger`}
                          >
                            <Avatar
                              src={otherPerson?.avatar_url}
                              name={name}
                              size="sm"
                            />
                            <div>
                              <div className="font-semibold text-[var(--on-surface)] group-hover:text-[var(--primary)] group-hover:underline transition-colors flex items-center gap-1.5 flex-wrap">
                                <span>{name}</span>
                                {isPurged && (
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 flex items-center gap-0.5"
                                    title="Transaction purged by administrator"
                                  >
                                    <span className="material-symbols-outlined text-[10px]">admin_panel_settings</span>
                                    <span>(Transaction purged by admin)</span>
                                  </span>
                                )}
                                {split && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/20 flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[11px]">call_split</span>
                                    <span>{split.title}</span>
                                  </span>
                                )}
                                {shareMeta?.globalEnabled && (
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[9px] font-mono text-[var(--on-surface-variant)] bg-[var(--surface-container-high)]/70 border border-[var(--outline-variant)]/25 flex items-center gap-0.5"
                                    title="Global public link enabled"
                                  >
                                    <span className="material-symbols-outlined text-[10px]">public</span>
                                    <span>Public</span>
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-xs text-[var(--on-surface-variant)]">
                                {otherPerson?.email} {cleanNotes ? `• "${cleanNotes}"` : ''}
                              </div>
                            </div>
                          </Link>
                        </td>

                        <td className="py-4">
                          {isPurged ? (
                            <span className="font-mono text-xs font-bold inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                              <span className="material-symbols-outlined text-[14px]">admin_panel_settings</span>
                              Purged
                            </span>
                          ) : d.status === 'declined' ? (
                            <span className="font-mono text-xs font-bold inline-flex items-center gap-1 text-red-500 dark:text-red-400">
                              <span className="material-symbols-outlined text-[14px]">block</span>
                              Declined
                            </span>
                          ) : (
                            <span
                              className={`font-mono text-xs font-bold inline-flex items-center gap-1 ${
                                isLender ? 'text-[var(--secondary)]' : 'text-[var(--error)]'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[14px]">
                                {isLender ? 'arrow_upward' : 'arrow_downward'}
                              </span>
                              {isLender ? 'Lent' : 'Borrowed'}
                            </span>
                          )}
                        </td>

                        <td className="py-4 font-mono text-xs text-[var(--on-surface-variant)]">
                          {isPurged || d.status === 'declined' ? (
                            <span className="line-through">
                              {d.interest_type === 'none' ? '0% (Interest-Free)' : `${d.interest_rate}% ${d.interest_type}`}
                            </span>
                          ) : d.interest_type === 'none' ? (
                            <span>0% (Interest-Free)</span>
                          ) : (
                            <span>
                              {d.interest_rate}% {d.interest_type} ({d.compound_freq || 'yr'})
                            </span>
                          )}
                        </td>

                        <td className="py-4 font-mono font-bold text-sm text-[var(--on-surface)]">
                          {isPurged ? (
                            <span className="text-red-500/80 dark:text-red-400/80 line-through text-xs font-mono">
                              Purged
                            </span>
                          ) : d.status === 'declined' ? (
                            <span className="text-red-500/80 dark:text-red-400/80 line-through text-xs font-mono">
                              Void
                            </span>
                          ) : (
                            formatCurrency(calc.currentBalance, d.currency || currency, { showDecimals: true })
                          )}
                        </td>

                        <td className="py-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Chip
                              label={isPurged ? 'purged' : d.status}
                              variant={
                                isPurged
                                  ? 'purged'
                                  : d.status === 'active'
                                  ? 'active'
                                  : d.status === 'settled'
                                  ? 'settled'
                                  : d.status === 'pending'
                                  ? 'pending'
                                  : d.status === 'declined'
                                  ? 'declined'
                                  : 'default'
                              }
                              icon={isPurged ? 'admin_panel_settings' : undefined}
                            />
                            {dueDateInfo && d.status !== 'declined' && !isPurged && (
                              <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-semibold border ${dueDateInfo.className} flex items-center gap-1`}>
                                <span className="material-symbols-outlined text-[11px]">
                                  {dueDateInfo.isOverdue ? 'warning' : 'event'}
                                </span>
                                {dueDateInfo.text}
                              </span>
                            )}
                            {unverifiedCount > 0 && d.status === 'active' && !isPurged && (
                              <span
                                className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold border flex items-center gap-1 ${
                                  isLender
                                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 animate-pulse'
                                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                }`}
                              >
                                <span className="material-symbols-outlined text-[11px]">
                                  {isLender ? 'fact_check' : 'hourglass_top'}
                                </span>
                                <span>{isLender ? 'Verify Payment' : 'Payment Pending Check'}</span>
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            {isPurged && (
                              <a
                                href={`mailto:support@satya-nayak.dev?subject=Support%20Inquiry%20-%20Purged%20Transaction%20${d.id}`}
                                className="px-2.5 py-1 rounded-lg border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 font-mono text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                title="Contact support at support@satya-nayak.dev"
                              >
                                <span className="material-symbols-outlined text-[13px]">mail</span>
                                <span>Support</span>
                              </a>
                            )}
                            {d.status === 'pending' && d.created_by !== currentUserId ? (
                              <button
                                onClick={() => handleAcceptDebt(d.id, 'active')}
                                className="px-2.5 py-1 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 shadow-xs cursor-pointer whitespace-nowrap"
                              >
                                Accept
                              </button>
                            ) : d.status === 'pending' && d.created_by === currentUserId ? (
                              <>
                                <button
                                  onClick={() => handleTakeBackPendingDebt(d.id)}
                                  className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/25 font-mono text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap"
                                  title="Take back and cancel this pending transaction"
                                >
                                  <span className="material-symbols-outlined text-[13px]">undo</span>
                                  <span>Take Back</span>
                                </button>
                                <button
                                  onClick={() => setSelectedDebtForEdit(d)}
                                  className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/30 font-mono text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap"
                                >
                                  <span className="material-symbols-outlined text-[13px]">edit</span>
                                  <span>Edit</span>
                                </button>
                              </>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => setSelectedDebtForDetail(d)}
                              className="px-2.5 py-1 rounded-lg bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-[var(--primary)] font-mono text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              title="View full agreement details, audit trail, and share link"
                            >
                              <span className="material-symbols-outlined text-[13px]">receipt_long</span>
                              <span>Details</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Detailed Debt Agreement & Share Modal */}
      {selectedDebtForDetail && (
        <DebtDetailModal
          isOpen={Boolean(selectedDebtForDetail)}
          debt={selectedDebtForDetail}
          currentUserId={currentUserId || ''}
          currency={currency}
          onClose={() => setSelectedDebtForDetail(null)}
          onDebtUpdated={fetchDashboardData}
        />
      )}

      {/* Edit Pending Debt Modal */}
      {selectedDebtForEdit && (
        <EditPendingDebtModal
          isOpen={Boolean(selectedDebtForEdit)}
          debt={selectedDebtForEdit}
          onClose={() => setSelectedDebtForEdit(null)}
          onDebtUpdated={fetchDashboardData}
        />
      )}
    </div>
  );
}
