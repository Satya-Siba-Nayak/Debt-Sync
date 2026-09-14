'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance, calculatePortfolioAccrualRates, round2 } from '@/lib/utils/interest';
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
import Link from 'next/link';

export default function GlobalDashboardPage() {
  const supabase = createClient();

  const initialCache = getLedgerCache();
  const [loading, setLoading] = useState(!initialCache);
  const [currency, setCurrency] = useState(initialCache?.currency || 'inr');
  const [debts, setDebts] = useState<Debt[]>(initialCache?.debts || []);
  const [payments, setPayments] = useState<Payment[]>(initialCache?.payments || []);
  const [currentUserId, setCurrentUserId] = useState<string | null>(initialCache?.userId || null);

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

      // Update hot client cache
      setLedgerCache({
        userId: user.id,
        debts: allDebts,
        payments: allPayments,
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

              return (
                <div
                  key={d.id}
                  className="bg-[var(--surface-container-lowest)] p-4 rounded-xl border border-[var(--outline-variant)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
                >
                  <div className="flex items-center gap-3">
                    <Avatar src={counterparty?.avatar_url} name={name} size="md" />
                    <div>
                      <div className="font-heading font-bold text-sm text-[var(--on-surface)]">
                        {name} <span className="font-normal text-xs text-[var(--on-surface-variant)]">recorded a transaction:</span>
                      </div>
                      <div className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
                        {isLender ? 'You Lent' : 'You Borrowed'}: <strong className="text-[var(--on-surface)] text-sm">{formatCurrency(d.principal, d.currency || currency)}</strong>
                        {' '}&bull;{' '}
                        {d.interest_type === 'none' ? '0% Interest-Free' : `${d.interest_rate}% ${d.interest_type}`}
                        {d.notes ? ` &bull; "${d.notes}"` : ''}
                      </div>
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

          <Link
            href="/directory"
            className="text-xs font-mono font-bold text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] hover:underline flex items-center gap-1"
          >
            <span>View All</span>
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          </Link>
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
            <div className="md:hidden space-y-3">
              {debts.slice(0, 6).map((d) => {
                const isLender = d.lender_id === currentUserId;
                const otherPerson = isLender ? d.borrower : d.lender;
                const name = otherPerson?.full_name || otherPerson?.email || 'Unknown';
                const debtPayments = payments.filter((p) => p.debt_id === d.id);
                const calc = calculateDebtBalance(d, debtPayments);
                const dueDateInfo = getDueDateInfo(d.due_date, d.status);

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
                        <div className="font-mono text-[11px] text-[var(--on-surface-variant)] mt-0.5">
                          {d.status === 'declined' ? (
                            <span className="line-through">{formatCurrency(d.principal, d.currency || currency)}</span>
                          ) : (
                            formatCurrency(d.principal, d.currency || currency)
                          )} • {d.interest_type === 'none' ? '0% Free' : `${d.interest_rate}% ${d.interest_type}`}
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
                  {debts.slice(0, 6).map((d) => {
                    const isLender = d.lender_id === currentUserId;
                    const otherPerson = isLender ? d.borrower : d.lender;
                    const name = otherPerson?.full_name || otherPerson?.email || 'Unknown';
                    const debtPayments = payments.filter((p) => p.debt_id === d.id);
                    const calc = calculateDebtBalance(d, debtPayments);
                    const dueDateInfo = getDueDateInfo(d.due_date, d.status);

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
                          <div className="flex items-center gap-3">
                            <Avatar
                              src={otherPerson?.avatar_url}
                              name={name}
                              size="sm"
                            />
                            <div>
                              <div className="font-semibold text-[var(--on-surface)]">{name}</div>
                              <div className="font-mono text-xs text-[var(--on-surface-variant)]">
                                {otherPerson?.email}
                              </div>
                            </div>
                          </div>
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
    </div>
  );
}
