'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance, calculatePortfolioAccrualRates, round2, sortDebtsActiveFirst } from '@/lib/utils/interest';
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
import { parseSplitDetails, getCleanDebtNotes } from '@/lib/utils/split-bills';
import { EditPendingDebtModal } from '@/components/debts/EditPendingDebtModal';
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

      // Claim any pending debts associated with user's email (cached)
      await claimUserProfile(user);

      // Fetch user settings and debts in parallel
      const [settingsRes, debtRecordsRes] = await Promise.all([
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

        // Auto-purge any historical unverified payments on settled debts
        const settledDebtIds = allDebts.filter((d) => d.status === 'settled').map((d) => d.id);
        if (settledDebtIds.length > 0) {
          supabase.from('payments').delete().in('debt_id', settledDebtIds).eq('is_verified', false);
        }
      }

      setDebts(allDebts);
      setPayments(allPayments);

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
  }, []);

  const handleAcceptDebt = async (debtId: string, decision: 'active' | 'declined') => {
    try {
      // 1. Try secure RPC
      let success = false;
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('accept_debt', {
          p_debt_id: debtId,
          p_decision: decision,
        });
        if (!rpcErr && rpcRes && rpcRes.success) success = true;
      } catch (_) {}

      if (!success) {
        const { error: updateErr } = await supabase
          .from('debts')
          .update({
            status: decision,
            accepted_at: decision === 'active' ? new Date().toISOString() : null,
          })
          .eq('id', debtId);
        if (updateErr) throw updateErr;
      }

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      fetchDashboardData();
    } catch (err: any) {
      console.error('Error updating debt:', err);
      alert(err.message || 'Failed to update debt agreement');
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
  }, [fetchDashboardData]);

  const incomingPendingDebts = debts.filter(
    (d) => d.status === 'pending' && d.created_by !== currentUserId
  );

  const sortedDebts = React.useMemo(() => sortDebtsActiveFirst(debts), [debts]);

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
                  className="bg-[var(--surface-container-lowest)] p-4 rounded-xl border border-[var(--outline-variant)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
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

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      onClick={() => handleAcceptDebt(d.id, 'declined')}
                      className="px-3 py-1.5 rounded-xl border border-error/30 text-error font-mono text-xs font-bold hover:bg-error/10 transition-colors cursor-pointer"
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
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="font-heading text-lg md:text-xl font-bold text-[var(--on-surface)]">
              Active Transactions
            </h3>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
              Recent micro-loans and peer obligations
            </p>
          </div>

          <div className="flex items-center gap-2.5">
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
              Click &quot;New Transaction&quot; to log your first loan or borrowing
            </p>
          </div>
        ) : (
          <div>
            {/* Mobile Card List (< md screens) */}
            <div className="md:hidden max-h-[480px] overflow-y-auto overscroll-contain modal-scroll-container pr-1 space-y-3">
              {sortedDebts.slice(0, 8).map((d) => {
                const isLender = d.lender_id === currentUserId;
                const otherPerson = isLender ? d.borrower : d.lender;
                const name = otherPerson?.full_name || otherPerson?.email || 'Unknown';
                const debtPayments = payments.filter((p) => p.debt_id === d.id);
                const calc = calculateDebtBalance(d, debtPayments);
                const dueDateInfo = getDueDateInfo(d.due_date, d.status);
                const split = parseSplitDetails(d);
                const cleanNotes = getCleanDebtNotes(d.notes);

                return (
                  <Link
                    key={d.id}
                    href={`/directory/detail?id=${otherPerson?.id || d.id}`}
                    className={`block p-4 rounded-xl border transition-all shadow-xs ${
                      d.status === 'declined'
                        ? 'bg-[var(--surface-container-low)]/40 border-red-500/20 opacity-85'
                        : 'bg-[var(--surface-container-low)]/70 hover:bg-[var(--surface-container-high)]/70 border-[var(--outline-variant)]/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar
                          src={otherPerson?.avatar_url}
                          name={name}
                          size="md"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-[var(--on-surface)] truncate">
                            {name}
                          </p>
                          <p className="font-mono text-xs text-[var(--on-surface-variant)] truncate">
                            {otherPerson?.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Chip
                          label={d.status}
                          variant={
                            d.status === 'active'
                              ? 'active'
                              : d.status === 'settled'
                              ? 'settled'
                              : d.status === 'pending'
                              ? 'pending'
                              : d.status === 'declined'
                              ? 'declined'
                              : 'default'
                          }
                        />
                        {dueDateInfo && d.status !== 'declined' && (
                          <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-semibold border ${dueDateInfo.className} flex items-center gap-1`}>
                            <span className="material-symbols-outlined text-[11px]">
                              {dueDateInfo.isOverdue ? 'warning' : 'event'}
                            </span>
                            {dueDateInfo.text}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-[var(--outline-variant)]/15 flex items-center justify-between">
                      <div>
                        {d.status === 'declined' ? (
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
                            {d.status === 'declined' ? (
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
                          {d.status === 'declined' ? (
                            <span className="text-red-500/80 dark:text-red-400/80 line-through text-xs font-mono">
                              Void
                            </span>
                          ) : (
                            formatCurrency(calc.currentBalance, d.currency || currency, { showDecimals: true })
                          )}
                        </span>
                      </div>
                    </div>

                    {d.status === 'pending' && d.created_by !== currentUserId && (
                      <div className="mt-3 pt-2.5 border-t border-[var(--outline-variant)]/15 flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            handleAcceptDebt(d.id, 'declined');
                          }}
                          className="px-3 py-1 rounded-lg border border-error/30 text-error font-mono text-xs font-bold hover:bg-error/10"
                        >
                          Decline
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            handleAcceptDebt(d.id, 'active');
                          }}
                          className="px-3.5 py-1 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 shadow-xs"
                        >
                          Accept
                        </button>
                      </div>
                    )}

                    {d.status === 'pending' && d.created_by === currentUserId && (
                      <div className="mt-3 pt-2.5 border-t border-[var(--outline-variant)]/15 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono text-amber-500/90 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]">schedule</span>
                          <span>Awaiting acceptance</span>
                        </span>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            setSelectedDebtForEdit(d);
                          }}
                          className="px-3 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/30 font-mono text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[13px]">edit</span>
                          <span>Edit</span>
                        </button>
                      </div>
                    )}
                  </Link>
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
                    const name = otherPerson?.full_name || otherPerson?.email || 'Unknown';
                    const debtPayments = payments.filter((p) => p.debt_id === d.id);
                    const calc = calculateDebtBalance(d, debtPayments);
                    const dueDateInfo = getDueDateInfo(d.due_date, d.status);
                    const split = parseSplitDetails(d);
                    const cleanNotes = getCleanDebtNotes(d.notes);

                    return (
                      <tr
                        key={d.id}
                        className={`transition-colors ${
                          d.status === 'declined'
                            ? 'bg-red-500/5 hover:bg-red-500/10 opacity-80'
                            : 'hover:bg-[var(--surface-container-low)]/50'
                        }`}
                      >
                        <td className="py-4">
                          <Link
                            href={`/directory/detail?id=${otherPerson?.id || d.id}`}
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
                                {split && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/20 flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[11px]">call_split</span>
                                    <span>{split.title}</span>
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
                          {d.status === 'declined' ? (
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
                          {d.status === 'declined' ? (
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
                          {d.status === 'declined' ? (
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
                              label={d.status}
                              variant={
                                d.status === 'active'
                                  ? 'active'
                                  : d.status === 'settled'
                                  ? 'settled'
                                  : d.status === 'pending'
                                  ? 'pending'
                                  : d.status === 'declined'
                                  ? 'declined'
                                  : 'default'
                              }
                            />
                            {dueDateInfo && d.status !== 'declined' && (
                              <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-semibold border ${dueDateInfo.className} flex items-center gap-1`}>
                                <span className="material-symbols-outlined text-[11px]">
                                  {dueDateInfo.isOverdue ? 'warning' : 'event'}
                                </span>
                                {dueDateInfo.text}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {d.status === 'pending' && d.created_by !== currentUserId ? (
                              <button
                                onClick={() => handleAcceptDebt(d.id, 'active')}
                                className="px-2.5 py-1 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 shadow-xs cursor-pointer"
                              >
                                Accept
                              </button>
                            ) : d.status === 'pending' && d.created_by === currentUserId ? (
                              <button
                                onClick={() => setSelectedDebtForEdit(d)}
                                className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/30 font-mono text-xs font-bold transition-colors cursor-pointer flex items-center gap-1"
                              >
                                <span className="material-symbols-outlined text-[13px]">edit</span>
                                <span>Edit</span>
                              </button>
                            ) : null}
                            <Link
                              href={`/directory/detail?id=${otherPerson?.id || d.id}`}
                              className="font-mono text-xs text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] font-bold hover:underline"
                            >
                              Details
                            </Link>
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
