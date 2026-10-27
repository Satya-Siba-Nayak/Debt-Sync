'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance, isDebtPurgedByAdmin, round2 } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { CashflowChart } from '@/components/dashboard/CashflowChart';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { getLedgerCache, setLedgerCache } from '@/lib/stores/ledger-store';
import { SkeletonBalanceCards } from '@/components/ui/Skeleton';
import {
  calculateTrustScore,
  fetchServerTrustScore,
  getCachedServerTrustScore,
  TrustScoreBreakdown,
} from '@/lib/utils/trust-score';
import { PAYMENT_METHOD_LABELS, isUPIMethod, PRIMARY_PAYMENT_METHODS } from '@/lib/utils/upi-link';
import { exportUserDataToCSV } from '@/lib/utils/export-csv';

export default function AnalyticsPage() {
  const supabase = createClient();

  const initialCache = getLedgerCache();
  const [loading, setLoading] = useState(!initialCache);
  const [currency, setCurrency] = useState(initialCache?.currency || 'inr');
  const [currentUserId, setCurrentUserId] = useState<string | null>(initialCache?.userId || null);
  const [debts, setDebts] = useState<Debt[]>(initialCache?.debts || []);
  const [payments, setPayments] = useState<Payment[]>(initialCache?.payments || []);
  const [userFlags, setUserFlags] = useState<{ isIsolated?: boolean; isVerified?: boolean }>({});
  const [serverTrustBreakdown, setServerTrustBreakdown] = useState<TrustScoreBreakdown | null>(
    () => getCachedServerTrustScore(initialCache?.userId)
  );
  const [showTrustDetails, setShowTrustDetails] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  const fetchAnalyticsData = useCallback(async () => {
    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) return;
      setCurrentUserId(user.id);

      const [settingsRes, profileRes, debtRowsRes] = await Promise.all([
        supabase
          .from('user_settings')
          .select('default_currency')
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('profiles')
          .select('is_isolated, is_verified')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('debts')
          .select(`
            *,
            lender:profiles!debts_lender_id_fkey(id, email, full_name, avatar_url, is_purged),
            borrower:profiles!debts_borrower_id_fkey(id, email, full_name, avatar_url, is_purged)
          `)
          .or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`),
      ]);

      const activeCurrency = settingsRes.data?.default_currency || currency;
      if (settingsRes.data?.default_currency) setCurrency(settingsRes.data.default_currency);

      const flags = {
        isIsolated: Boolean(profileRes.data?.is_isolated),
        isVerified: Boolean(profileRes.data?.is_verified),
      };
      setUserFlags(flags);

      const allDebts: Debt[] = (debtRowsRes.data as any) || [];
      const debtIds = allDebts.map((d) => d.id);
      let allPayments: Payment[] = [];

      if (debtIds.length > 0) {
        const { data: paymentRows } = await supabase
          .from('payments')
          .select('*')
          .in('debt_id', debtIds);
        allPayments = (paymentRows as any) || [];
      }

      setDebts(allDebts);
      setPayments(allPayments);

      setLedgerCache({
        userId: user.id,
        debts: allDebts,
        payments: allPayments,
        currency: activeCurrency,
        timestamp: Date.now(),
      });

      // Fetch authoritative server-provided dynamic network trust score
      const srvTrust = await fetchServerTrustScore(
        supabase,
        user.id,
        allDebts,
        allPayments,
        flags
      );
      setServerTrustBreakdown(srvTrust);
    } catch (err) {
      console.error('Error loading analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, currency]);

  useEffect(() => {
    fetchAnalyticsData();

    const handleRefresh = () => fetchAnalyticsData();
    window.addEventListener('debtsync:refresh', handleRefresh);

    const channel = supabase
      .channel('analytics-realtime-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'debts' }, () => {
        fetchAnalyticsData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchAnalyticsData();
      })
      .subscribe();

    return () => {
      window.removeEventListener('debtsync:refresh', handleRefresh);
      supabase.removeChannel(channel);
    };
  }, [fetchAnalyticsData, supabase]);

  const handleExportCSV = async () => {
    if (!currentUserId || exportingCsv) return;
    setExportingCsv(true);
    try {
      await exportUserDataToCSV(supabase, currentUserId);
    } finally {
      setExportingCsv(false);
    }
  };

  // Aggregate metrics
  let totalLent = 0;
  let totalOwed = 0;
  let interestAccrued = 0;
  let borrowingInterestCost = 0;
  let simpleInterestTotal = 0;
  let compoundInterestTotal = 0;
  let totalRepaymentsReceived = 0;
  let totalRepaymentsMade = 0;
  let settledDebtsCount = 0;
  let activeLentCount = 0;
  let activeOwedCount = 0;
  let pendingCount = 0;
  let lifetimeLentPrincipal = 0;
  let lifetimeBorrowedPrincipal = 0;

  const counterpartyMap = new Map<
    string,
    {
      id: string;
      name: string;
      email: string;
      lentBalance: number;
      owedBalance: number;
      totalPaid: number;
      totalPrincipal: number;
      activeCount: number;
      settledCount: number;
    }
  >();

  const validDebtIds = new Set<string>();
  for (const d of debts) {
    if (d.status === 'declined' || d.status === 'purged' || isDebtPurgedByAdmin(d)) continue;
    validDebtIds.add(d.id);
    if (d.status === 'settled') settledDebtsCount++;
    if (d.status === 'pending') pendingCount++;

    const debtPayments = payments.filter((p) => p.debt_id === d.id);
    const calc = calculateDebtBalance(d, debtPayments);
    const isLender = d.lender_id === currentUserId;

    if (isLender) {
      lifetimeLentPrincipal += Number(d.principal) || 0;
      if (d.status === 'active') {
        totalLent += calc.currentBalance;
        activeLentCount++;
      }
      interestAccrued += calc.totalAccruedInterest;
      totalRepaymentsReceived += calc.totalPaid;
    } else {
      lifetimeBorrowedPrincipal += Number(d.principal) || 0;
      if (d.status === 'active') {
        totalOwed += calc.currentBalance;
        activeOwedCount++;
      }
      borrowingInterestCost += calc.totalAccruedInterest;
      totalRepaymentsMade += calc.totalPaid;
    }

    if (d.interest_type === 'simple') simpleInterestTotal += calc.totalAccruedInterest;
    if (d.interest_type === 'compound') compoundInterestTotal += calc.totalAccruedInterest;

    // Counterparty aggregation
    const otherParty = isLender ? d.borrower : d.lender;
    const cpId = otherParty?.id || (isLender ? d.borrower_id : d.lender_id) || d.id;
    const cpName = otherParty?.full_name || otherParty?.email || 'Counterparty';
    const cpEmail = otherParty?.email || '';
    const existing = counterpartyMap.get(cpId) || {
      id: cpId,
      name: cpName,
      email: cpEmail,
      lentBalance: 0,
      owedBalance: 0,
      totalPaid: 0,
      totalPrincipal: 0,
      activeCount: 0,
      settledCount: 0,
    };

    if (d.status === 'active') {
      if (isLender) existing.lentBalance = round2(existing.lentBalance + calc.currentBalance);
      else existing.owedBalance = round2(existing.owedBalance + calc.currentBalance);
      existing.activeCount += 1;
    } else if (d.status === 'settled') {
      existing.settledCount += 1;
    }
    existing.totalPaid = round2(existing.totalPaid + calc.totalPaid);
    existing.totalPrincipal = round2(existing.totalPrincipal + (Number(d.principal) || 0));
    counterpartyMap.set(cpId, existing);
  }

  totalLent = round2(totalLent);
  totalOwed = round2(totalOwed);
  interestAccrued = round2(interestAccrued);
  borrowingInterestCost = round2(borrowingInterestCost);
  simpleInterestTotal = round2(simpleInterestTotal);
  compoundInterestTotal = round2(compoundInterestTotal);
  totalRepaymentsReceived = round2(totalRepaymentsReceived);
  totalRepaymentsMade = round2(totalRepaymentsMade);
  lifetimeLentPrincipal = round2(lifetimeLentPrincipal);
  lifetimeBorrowedPrincipal = round2(lifetimeBorrowedPrincipal);
  const netPosition = round2(totalLent - totalOwed);

  const topCounterparties = Array.from(counterpartyMap.values())
    .sort((a, b) => (b.lentBalance + b.owedBalance + b.totalPrincipal) - (a.lentBalance + a.owedBalance + a.totalPrincipal))
    .slice(0, 5);

  // Real Repayment Velocity:
  // % of total obligations (lent + borrowed) that have been repaid
  const grandObligations = totalLent + totalRepaymentsReceived + totalOwed + totalRepaymentsMade;
  const totalRepaidBothWays = totalRepaymentsReceived + totalRepaymentsMade;
  const repaymentVelocityPercent = grandObligations > 0
    ? Math.min(100, Math.round((totalRepaidBothWays / grandObligations) * 100))
    : validDebtIds.size === 0 ? 100 : 0;

  // Comprehensive Server-Provided Network Trust Score Breakdown & Performance Factors
  const trustBreakdown =
    serverTrustBreakdown ||
    calculateTrustScore(debts, payments, currentUserId || undefined, userFlags);
  const trustScore = trustBreakdown.score;
  const trustRating = trustBreakdown.rating;
  const trustRatingColor = trustBreakdown.ratingColor;
  const trustFactors = trustBreakdown.factors;
  const trustPillars = trustBreakdown.pillars;

  // Payment Channel & Methods Distribution (Consolidated under UPI with TPAP app breakdown)
  const channelStats: Record<string, { count: number; volume: number }> = {
    upi: { count: 0, volume: 0 },
    bank_transfer: { count: 0, volume: 0 },
    cash: { count: 0, volume: 0 },
    other: { count: 0, volume: 0 },
  };

  const upiAppBreakdown: Record<string, { label: string; count: number; volume: number }> = {
    gpay: { label: 'Google Pay', count: 0, volume: 0 },
    phonepe: { label: 'PhonePe', count: 0, volume: 0 },
    paytm: { label: 'Paytm', count: 0, volume: 0 },
    other_upi: { label: 'BHIM & Bank UPI', count: 0, volume: 0 },
  };

  for (const p of payments) {
    if (!p.is_verified || !validDebtIds.has(p.debt_id)) continue;
    const mode = (p.payment_method || 'other').toLowerCase();
    const amount = Number(p.amount) || 0;

    if (isUPIMethod(mode)) {
      channelStats.upi.count += 1;
      channelStats.upi.volume = round2(channelStats.upi.volume + amount);

      const noteText = typeof p.note === 'string' ? p.note.toUpperCase() : '';
      if (mode === 'gpay' || mode === 'google_pay' || noteText.includes('[UPI: GPAY]') || noteText.includes('GOOGLE PAY')) {
        upiAppBreakdown.gpay.count += 1;
        upiAppBreakdown.gpay.volume = round2(upiAppBreakdown.gpay.volume + amount);
      } else if (mode === 'phonepe' || noteText.includes('[UPI: PHONEPE]') || noteText.includes('PHONEPE')) {
        upiAppBreakdown.phonepe.count += 1;
        upiAppBreakdown.phonepe.volume = round2(upiAppBreakdown.phonepe.volume + amount);
      } else if (mode === 'paytm' || noteText.includes('[UPI: PAYTM]') || noteText.includes('PAYTM')) {
        upiAppBreakdown.paytm.count += 1;
        upiAppBreakdown.paytm.volume = round2(upiAppBreakdown.paytm.volume + amount);
      } else {
        upiAppBreakdown.other_upi.count += 1;
        upiAppBreakdown.other_upi.volume = round2(upiAppBreakdown.other_upi.volume + amount);
      }
    } else if (mode === 'bank_transfer') {
      channelStats.bank_transfer.count += 1;
      channelStats.bank_transfer.volume = round2(channelStats.bank_transfer.volume + amount);
    } else if (mode === 'cash') {
      channelStats.cash.count += 1;
      channelStats.cash.volume = round2(channelStats.cash.volume + amount);
    } else {
      channelStats.other.count += 1;
      channelStats.other.volume = round2(channelStats.other.volume + amount);
    }
  }

  // Debt Age Distribution (using remaining unpaid balance on active non-purged debts)
  const ageBuckets: Record<string, { amount: number; count: number }> = {
    '0-30d': { amount: 0, count: 0 },
    '31-60d': { amount: 0, count: 0 },
    '61-90d': { amount: 0, count: 0 },
    '91-120d': { amount: 0, count: 0 },
    '>120d': { amount: 0, count: 0 },
  };
  const now = Date.now();
  for (const d of debts) {
    if (d.status !== 'active' || isDebtPurgedByAdmin(d)) continue;
    const debtPayments = payments.filter((p) => p.debt_id === d.id);
    const remBal = calculateDebtBalance(d, debtPayments).currentBalance;
    if (remBal <= 0) continue;
    const days = Math.floor((now - new Date(d.created_at).getTime()) / (1000 * 60 * 60 * 24));
    const key =
      days <= 30
        ? '0-30d'
        : days <= 60
        ? '31-60d'
        : days <= 90
        ? '61-90d'
        : days <= 120
        ? '91-120d'
        : '>120d';
    ageBuckets[key].amount = round2(ageBuckets[key].amount + remBal);
    ageBuckets[key].count += 1;
  }

  const bucketAmounts = Object.values(ageBuckets).map((b) => b.amount);
  const totalAgeExposure = round2(bucketAmounts.reduce((s, v) => s + v, 0));
  const maxBucketVal = Math.max(...bucketAmounts, 1);

  // Real 6-month Liquidity & Maturity Forecast combining scheduled due_dates and open receivables
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nowDate = new Date();
  const undatedLentTotal = debts
    .filter((d) => d.status === 'active' && d.lender_id === currentUserId && !d.due_date && !isDebtPurgedByAdmin(d))
    .reduce((sum, d) => {
      const p = payments.filter((pay) => pay.debt_id === d.id);
      return sum + calculateDebtBalance(d, p).currentBalance;
    }, 0);
  const undatedOwedTotal = debts
    .filter((d) => d.status === 'active' && d.borrower_id === currentUserId && !d.due_date && !isDebtPurgedByAdmin(d))
    .reduce((sum, d) => {
      const p = payments.filter((pay) => pay.debt_id === d.id);
      return sum + calculateDebtBalance(d, p).currentBalance;
    }, 0);

  const liquidityForecast = Array.from({ length: 6 }).map((_, idx) => {
    const targetDate = new Date(nowDate.getFullYear(), nowDate.getMonth() + idx, 1);
    const targetYear = targetDate.getFullYear();
    const targetMonth = targetDate.getMonth();
    const label = `${monthNames[targetMonth]} ${targetYear}`;

    let scheduledReceivable = 0;
    let scheduledPayable = 0;
    let dueCount = 0;

    for (const d of debts) {
      if (d.status !== 'active' || !d.due_date || isDebtPurgedByAdmin(d)) continue;
      const due = new Date(d.due_date);
      const isDueThisMonth =
        due.getFullYear() === targetYear && due.getMonth() === targetMonth;
      const isOverdueIntoCurrentMonth =
        idx === 0 && due.getTime() < targetDate.getTime();

      if (isDueThisMonth || isOverdueIntoCurrentMonth) {
        const p = payments.filter((pay) => pay.debt_id === d.id);
        const bal = calculateDebtBalance(d, p).currentBalance;
        if (bal > 0) {
          dueCount += 1;
          if (d.lender_id === currentUserId) scheduledReceivable += bal;
          else scheduledPayable += bal;
        }
      }
    }

    const projectedOpenInflow = undatedLentTotal > 0 ? undatedLentTotal / 6 : 0;
    const projectedOpenOutflow = undatedOwedTotal > 0 ? undatedOwedTotal / 6 : 0;

    const totalExpectedInflow = round2(scheduledReceivable + projectedOpenInflow);
    const totalExpectedOutflow = round2(scheduledPayable + projectedOpenOutflow);
    const netFlow = round2(totalExpectedInflow - totalExpectedOutflow);

    return {
      month: label,
      inflow: totalExpectedInflow,
      outflow: totalExpectedOutflow,
      netFlow,
      dueCount,
      status: dueCount > 0 ? `${dueCount} Scheduled` : totalExpectedInflow > 0 || totalExpectedOutflow > 0 ? 'Projected' : 'Clear',
    };
  });

  return (
    <div className="page-enter space-y-6 md:space-y-8">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)]">
            Analytics &amp; Performance Hub
          </h1>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-1">
            Comprehensive portfolio health, counterparty exposure, and maturity schedule
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={exportingCsv || !currentUserId}
            className="px-3.5 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container-lowest)] hover:bg-[var(--surface-container)] text-[var(--on-surface)] font-mono text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
            title="Download full financial ledger archive as CSV"
          >
            <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">download</span>
            <span>{exportingCsv ? 'Exporting...' : 'Export CSV Archive'}</span>
          </button>
        </div>
      </div>

      {/* Top 4 Institutional KPI Summary Cards */}
      {loading && debts.length === 0 ? (
        <SkeletonBalanceCards />
      ) : (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Active Receivable */}
          <div className="bg-[var(--surface-container-lowest)] p-5 rounded-2xl border border-[var(--outline-variant)]/30 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
                  Active Receivable
                </span>
                <div className="w-8 h-8 rounded-xl bg-emerald-500/12 text-[var(--secondary)] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">call_made</span>
                </div>
              </div>
              <div className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)]">
                {formatCurrency(totalLent, currency)}
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-[var(--outline-variant)]/15 flex items-center justify-between text-[11px] font-mono text-[var(--on-surface-variant)]">
              <span>Collected: <strong className="text-[var(--secondary)]">{formatCurrency(totalRepaymentsReceived, currency)}</strong></span>
              <span>{activeLentCount} active</span>
            </div>
          </div>

          {/* Active Payable */}
          <div className="bg-[var(--surface-container-lowest)] p-5 rounded-2xl border border-[var(--outline-variant)]/30 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
                  Active Payable
                </span>
                <div className="w-8 h-8 rounded-xl bg-red-500/12 text-[var(--error)] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">call_received</span>
                </div>
              </div>
              <div className="font-heading text-2xl md:text-3xl font-bold text-[var(--error)]">
                {formatCurrency(totalOwed, currency)}
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-[var(--outline-variant)]/15 flex items-center justify-between text-[11px] font-mono text-[var(--on-surface-variant)]">
              <span>Repaid: <strong className="text-[var(--on-surface)]">{formatCurrency(totalRepaymentsMade, currency)}</strong></span>
              <span>{activeOwedCount} active</span>
            </div>
          </div>

          {/* Net Portfolio Position */}
          <div className="bg-[var(--primary)] text-[var(--on-primary)] p-5 rounded-2xl shadow-md flex flex-col justify-between relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/10 blur-xl pointer-events-none" />
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-xs uppercase tracking-wider font-semibold opacity-90">
                  Net Position
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/20 text-white">
                  {netPosition > 0 ? 'Creditor' : netPosition < 0 ? 'Borrower' : 'Balanced'}
                </span>
              </div>
              <div className="font-heading text-2xl md:text-3xl font-bold">
                {netPosition > 0 ? '+' : ''}
                {formatCurrency(netPosition, currency)}
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-white/15 flex items-center justify-between text-[11px] font-mono opacity-90">
              <span>Lifetime Vol: {formatCurrency(lifetimeLentPrincipal + lifetimeBorrowedPrincipal, currency)}</span>
              <span>{settledDebtsCount} settled</span>
            </div>
          </div>

          {/* Accrued Interest Yield */}
          <div className="bg-[var(--surface-container-lowest)] p-5 rounded-2xl border border-[var(--outline-variant)]/30 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
                  Interest Yield
                </span>
                <div className="w-8 h-8 rounded-xl bg-[var(--primary)]/12 text-[var(--primary)] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">monitoring</span>
                </div>
              </div>
              <div className="font-heading text-2xl md:text-3xl font-bold text-[var(--secondary)]">
                +{formatCurrency(interestAccrued, currency, { showDecimals: true })}
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-[var(--outline-variant)]/15 flex items-center justify-between text-[11px] font-mono text-[var(--on-surface-variant)]">
              <span>Borrow Cost: {formatCurrency(borrowingInterestCost, currency, { showDecimals: true })}</span>
              <span>{pendingCount > 0 ? `${pendingCount} pending` : 'Verified'}</span>
            </div>
          </div>
        </section>
      )}

      {/* Interactive Financial Growth & Cashflow Chart */}
      <CashflowChart
        debts={debts}
        payments={payments}
        currentUserId={currentUserId}
        currency={currency}
      />

      {/* 2-Column Analytics Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Net Flow, Age Distribution, Forecast & Counterparty Exposure */}
        <div className="lg:col-span-8 space-y-6">
          {/* Debt Age Distribution */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm">
            <div className="flex justify-between items-center mb-6 flex-wrap gap-2">
              <div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Active Debt Age Distribution
                </h3>
                <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
                  Unpaid active balance grouped by days elapsed since origination
                </p>
              </div>
              <span className="font-mono text-xs font-bold text-[var(--on-surface)] bg-[var(--surface-container)] px-3 py-1 rounded-lg border border-[var(--outline-variant)]/20">
                Active Exposure: {formatCurrency(totalAgeExposure, currency)}
              </span>
            </div>

            <div className="h-52 flex items-end gap-3 sm:gap-5 pt-8 border-b border-[var(--outline-variant)]/20 pb-3">
              {Object.entries(ageBuckets).map(([bucket, data], idx) => {
                const { amount, count } = data;
                const heightPercent = amount > 0 ? Math.max(14, Math.round((amount / maxBucketVal) * 100)) : 3;
                const shareOfTotal = totalAgeExposure > 0 ? Math.round((amount / totalAgeExposure) * 100) : 0;
                const isOverdueRisk = idx >= 3;
                return (
                  <div key={bucket} className="flex-1 flex flex-col items-center gap-1.5 group h-full justify-end min-w-0">
                    <span
                      className={`font-mono text-[10px] sm:text-[11px] font-bold truncate max-w-full ${
                        amount > 0
                          ? isOverdueRisk
                            ? 'text-[var(--error)]'
                            : 'text-[var(--on-surface)]'
                          : 'text-[var(--outline)]'
                      }`}
                    >
                      {formatCurrency(amount, currency)}
                    </span>
                    <div className="w-full flex-1 flex items-end justify-center">
                      <div
                        className={`w-full max-w-[64px] rounded-t-lg transition-all duration-300 ${
                          amount === 0
                            ? 'bg-[var(--outline-variant)]/30'
                            : isOverdueRisk
                            ? 'bg-[var(--error)]/80 group-hover:bg-[var(--error)] shadow-xs'
                            : 'bg-[var(--secondary)]/85 group-hover:bg-[var(--secondary)] shadow-xs'
                        }`}
                        style={{ height: `${heightPercent}%` }}
                        title={`${bucket}: ${formatCurrency(amount, currency)} (${count} active ${count === 1 ? 'contract' : 'contracts'})`}
                      />
                    </div>
                    <div className="text-center mt-1">
                      <span className="font-mono text-xs text-[var(--on-surface)] font-semibold block">
                        {bucket}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--on-surface-variant)] block">
                        {amount > 0 ? `${shareOfTotal}% (${count})` : '0 txns'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 6-Month Liquidity & Maturity Forecast Table */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  6-Month Maturity &amp; Liquidity Schedule
                </h3>
                <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
                  Scheduled due-date settlements combined with amortized open receivables
                </p>
              </div>
              <span className="font-mono text-[11px] text-[var(--on-surface-variant)] bg-[var(--surface-container)] px-2.5 py-1 rounded-lg">
                Rolling 6M Window
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-body-md text-xs">
                <thead>
                  <tr className="border-b border-[var(--outline-variant)]/20 font-mono text-[var(--on-surface-variant)] uppercase">
                    <th className="pb-3 font-semibold">Period</th>
                    <th className="pb-3 font-semibold">Expected Inflow</th>
                    <th className="pb-3 font-semibold">Payable Outflow</th>
                    <th className="pb-3 font-semibold">Net Cashflow</th>
                    <th className="pb-3 font-semibold text-right">Schedule</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--outline-variant)]/10 font-mono">
                  {liquidityForecast.map((row) => (
                    <tr key={row.month} className="hover:bg-[var(--surface-container-low)]/50">
                      <td className="py-3 font-semibold text-[var(--on-surface)]">{row.month}</td>
                      <td className="py-3 font-bold text-[var(--secondary)]">
                        +{formatCurrency(row.inflow, currency)}
                      </td>
                      <td className="py-3 text-[var(--error)]">
                        {row.outflow > 0 ? `-${formatCurrency(row.outflow, currency)}` : formatCurrency(0, currency)}
                      </td>
                      <td
                        className={`py-3 font-bold ${
                          row.netFlow > 0
                            ? 'text-[var(--primary)]'
                            : row.netFlow < 0
                            ? 'text-[var(--error)]'
                            : 'text-[var(--on-surface-variant)]'
                        }`}
                      >
                        {row.netFlow > 0 ? '+' : ''}
                        {formatCurrency(row.netFlow, currency)}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            row.dueCount > 0
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                              : row.inflow > 0 || row.outflow > 0
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                              : 'bg-[var(--surface-container-high)] text-[var(--on-surface-variant)]'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Counterparty Exposure & Concentration */}
          {topCounterparties.length > 0 && (
            <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                <div>
                  <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                    Top Counterparty Exposure
                  </h3>
                  <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
                    Bilateral concentration and repayment progress by contact
                  </p>
                </div>
                <Link
                  href="/directory"
                  className="font-mono text-xs font-bold text-[var(--primary)] hover:underline flex items-center gap-0.5"
                >
                  <span>Directory</span>
                  <span className="material-symbols-outlined text-[15px]">chevron_right</span>
                </Link>
              </div>

              <div className="space-y-3">
                {topCounterparties.map((cp) => {
                  const cpNet = round2(cp.lentBalance - cp.owedBalance);
                  const cpTotalObligation = cp.lentBalance + cp.owedBalance + cp.totalPaid;
                  const cpRepaidPct =
                    cpTotalObligation > 0
                      ? Math.min(100, Math.round((cp.totalPaid / cpTotalObligation) * 100))
                      : 100;

                  return (
                    <Link
                      key={cp.id}
                      href={`/directory/detail?id=${cp.id}`}
                      className="block p-3.5 rounded-xl bg-[var(--surface-container-low)]/70 hover:bg-[var(--surface-container)] border border-[var(--outline-variant)]/20 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <div className="font-heading font-bold text-sm text-[var(--on-surface)] truncate">
                            {cp.name}
                          </div>
                          <div className="font-mono text-[11px] text-[var(--on-surface-variant)]">
                            {cp.activeCount} active &bull; {cp.settledCount} settled &bull; Repaid {cpRepaidPct}%
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div
                            className={`font-mono text-sm font-bold ${
                              cpNet > 0
                                ? 'text-[var(--secondary)]'
                                : cpNet < 0
                                ? 'text-[var(--error)]'
                                : 'text-[var(--on-surface-variant)]'
                            }`}
                          >
                            {cpNet > 0 ? '+' : ''}
                            {formatCurrency(cpNet, currency)}
                          </div>
                          <span className="font-mono text-[10px] text-[var(--on-surface-variant)]">
                            {cpNet > 0 ? 'Owes You' : cpNet < 0 ? 'You Owe' : 'Settled'}
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-[var(--surface-container-high)] overflow-hidden">
                        <div
                          className="h-full bg-[var(--primary)] rounded-full transition-all duration-500"
                          style={{ width: `${cpRepaidPct}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Payment Channels & Modes Distribution */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Payment Channels &amp; Modes
                </h3>
                <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
                  Repayment volumes grouped by verified transaction method
                </p>
              </div>
              <span className="font-mono text-xs text-[var(--on-surface-variant)] bg-[var(--surface-container)] px-3 py-1 rounded-lg">
                Channels
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              {PRIMARY_PAYMENT_METHODS.map((mode) => {
                const meta = PAYMENT_METHOD_LABELS[mode];
                const stats = channelStats[mode] || { count: 0, volume: 0 };
                return (
                  <div
                    key={mode}
                    className="p-3.5 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/20 flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">
                        {meta?.icon || 'payment'}
                      </span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] font-semibold">
                        {stats.count} txns
                      </span>
                    </div>
                    <div>
                      <span className="font-mono text-[11px] text-[var(--on-surface-variant)] block">
                        {meta?.label || mode}
                      </span>
                      <span className="font-mono font-bold text-sm text-[var(--on-surface)]">
                        {formatCurrency(stats.volume, currency)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* UPI TPAP Apps Breakdown */}
            {channelStats.upi.count > 0 && (
              <div className="mt-4 p-3.5 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/20 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-[var(--on-surface)]">
                    <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">apps</span>
                    <span>UPI App Ecosystem (TPAPs)</span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--on-surface-variant)]">
                    All apps settle through NPCI Unified Payments Interface
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(upiAppBreakdown).map(([key, stat]) => (
                    <div key={key} className="p-2.5 rounded-lg bg-[var(--surface-container-high)]/70 border border-[var(--outline-variant)]/15 text-xs font-mono">
                      <div className="flex items-center justify-between text-[10px] text-[var(--on-surface-variant)] mb-1">
                        <span className="font-semibold">{stat.label}</span>
                        <span className="px-1.5 py-0.2 rounded bg-[var(--surface-container)]">{stat.count} txns</span>
                      </div>
                      <div className="font-bold text-[var(--on-surface)]">
                        {formatCurrency(stat.volume, currency)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Trust Score & Velocity */}
        <div className="lg:col-span-4 space-y-6">
          {/* Trust Score Card matching Stitch with Factor Breakdown */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm flex flex-col items-center text-center">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
              trustScore === -1
                ? 'bg-[var(--surface-container-high)] text-[var(--outline)]'
                : 'bg-[var(--surface-container-high)] text-[var(--primary)]'
            }`}>
              <span className="material-symbols-outlined text-[22px]">
                {trustScore === -1 ? 'history_toggle_off' : 'verified_user'}
              </span>
            </div>
            <span className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)]">
              Network Trust Score
            </span>

            {/* Geometric diamond badge */}
            <div className="my-6 relative w-36 h-36 flex items-center justify-center">
              <div
                className={`absolute inset-0 border-2 rotate-45 rounded-2xl ${
                  trustScore === -1
                    ? 'border-[var(--outline-variant)]/60'
                    : 'border-[var(--primary)]'
                }`}
              />
              <div className="relative z-10 flex flex-col items-center">
                <span className={`font-numeric-ticker text-4xl font-bold ${
                  trustScore === -1 ? 'text-[var(--outline)]' : 'text-[var(--on-surface)]'
                }`}>
                  {trustScore}
                </span>
                <span className={`font-mono text-xs font-bold uppercase mt-0.5 ${
                  trustScore === -1 ? 'text-[var(--outline)]' : trustRatingColor
                }`}>
                  {trustRating}
                </span>
              </div>
            </div>

            <p className="font-mono text-xs text-[var(--on-surface-variant)] leading-relaxed mb-4">
              {trustScore === -1
                ? 'No confirmed agreements on-ledger yet. Your server-calibrated network score (300–850) will dynamically activate as soon as your first agreement is accepted or settled.'
                : `Server-calibrated across ${settledDebtsCount} settled cycles, ${trustPillars.debtClearance}% obligation clearance, and on-time records.`}
            </p>

            {/* 4-Pillar Mini Bars when rated */}
            {trustScore !== -1 && (
              <div className="w-full grid grid-cols-2 gap-2 mb-4 text-left">
                {[
                  { label: 'Punctuality', val: trustPillars.paymentHistory },
                  { label: 'Clearance', val: trustPillars.debtClearance },
                  { label: 'Peer Breadth', val: trustPillars.networkBreadth },
                  { label: 'Dispute-Free', val: trustPillars.disputeCleanliness },
                ].map((pil) => (
                  <div key={pil.label} className="p-2 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/20">
                    <div className="flex items-center justify-between font-mono text-[10px] mb-1">
                      <span className="text-[var(--on-surface-variant)]">{pil.label}</span>
                      <span className="font-bold text-[var(--on-surface)]">{pil.val}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--surface-container-highest)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--primary)] rounded-full transition-all duration-500"
                        style={{ width: `${pil.val}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Factor breakdown toggle button */}
            <button
              type="button"
              onClick={() => setShowTrustDetails(!showTrustDetails)}
              className="w-full py-2 px-3 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--primary)] font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <span className="material-symbols-outlined text-[16px]">tune</span>
              <span>{showTrustDetails ? 'Hide Score Breakdown' : 'Why this score? (Factors & Tips)'}</span>
            </button>

            {/* Expandable Breakdown Panel */}
            {showTrustDetails && (
              <div className="w-full mt-4 text-left space-y-4 pt-4 border-t border-[var(--outline-variant)]/20 animate-in fade-in duration-200">
                {/* Contributing Factors */}
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-wider font-bold text-[var(--on-surface)] block mb-2">
                    Score Contributions
                  </span>
                  <div className="space-y-1.5">
                    {trustFactors.map((f) => (
                      <div
                        key={f.name}
                        className="p-2 rounded-xl bg-[var(--surface-container)] flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="material-symbols-outlined text-[16px] text-[var(--primary)] shrink-0">
                            {f.icon}
                          </span>
                          <div className="min-w-0">
                            <span className="font-bold text-[var(--on-surface)] block truncate text-[11px]">
                              {f.name}
                            </span>
                            <span className="text-[10px] text-[var(--on-surface-variant)] block leading-tight">
                              {f.description}
                            </span>
                          </div>
                        </div>
                        <span
                          className={`font-mono font-bold text-xs shrink-0 ml-2 ${
                            f.points > 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : f.points < 0
                              ? 'text-[var(--error)]'
                              : 'text-[var(--on-surface-variant)]'
                          }`}
                        >
                          {f.points > 0 ? `+${f.points}` : f.points}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* How to Increase */}
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-mono text-[11px] font-bold uppercase tracking-wider">
                    <span className="material-symbols-outlined text-[15px]">trending_up</span>
                    <span>How to Increase Score</span>
                  </div>
                  <ul className="text-[11px] font-mono text-[var(--on-surface)] space-y-1 pl-4 list-disc marker:text-emerald-500">
                    <li>Settle dated agreements on or before the due date (+18 pts each) or open agreements (+12 pts).</li>
                    <li>Maintain obligation clearance ≥ 85% (+30 pts) and active agreements with 0 overdue balances (+15 pts).</li>
                    <li>Build verified settlements across 3+ distinct counterparties (+25 to +40 network breadth bonus).</li>
                  </ul>
                </div>

                {/* Actions that Lower Score */}
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400 font-mono text-[11px] font-bold uppercase tracking-wider">
                    <span className="material-symbols-outlined text-[15px]">warning</span>
                    <span>What Lowers Your Score</span>
                  </div>
                  <ul className="text-[11px] font-mono text-[var(--on-surface)] space-y-1 pl-4 list-disc marker:text-red-500">
                    <li>Active overdue debts incur graduated delinquency deductions (-25 to -65 pts per overdue debt).</li>
                    <li>Contested or disputed transactions deduct -40 points until resolved.</li>
                    <li>Settling past the agreed due date (-12 pts) or repeated rejected outbound proposals (-20 pts).</li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Repayment Velocity Card */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 border border-[var(--outline-variant)]/30 shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <span className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)]">
                Repayment Velocity
              </span>
              <span className="font-mono text-xs text-[var(--secondary)] font-bold">
                {repaymentVelocityPercent}% Completed
              </span>
            </div>

            <div className="font-heading text-3xl font-bold text-[var(--on-surface)] my-2">
              {repaymentVelocityPercent}%
            </div>

            {/* Velocity Bar */}
            <div className="w-full h-2.5 bg-[var(--surface-container)] rounded-full overflow-hidden flex my-3">
              <div
                className="bg-[var(--secondary)] h-full rounded-full transition-all"
                style={{ width: `${repaymentVelocityPercent}%` }}
              />
              <div
                className="bg-[var(--error)]/70 h-full transition-all"
                style={{ width: `${100 - repaymentVelocityPercent}%` }}
              />
            </div>

            <div className="flex justify-between font-mono text-[11px] text-[var(--on-surface-variant)]">
              <span>Healthy Range</span>
              <span>Pending Obligations</span>
            </div>
          </div>

          {/* Interest Yield Breakdown */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 border border-[var(--outline-variant)]/30 shadow-sm">
            <span className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)] block mb-1">
              Interest Yield
            </span>
            <div className="font-numeric-ticker text-2xl font-bold text-[var(--on-surface)]">
              {formatCurrency(interestAccrued, currency, { showDecimals: true })}
            </div>

            <div className="mt-4 space-y-2 text-xs font-mono">
              <div className="flex justify-between text-[var(--on-surface-variant)]">
                <span className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--primary)]" />
                  Compound Accrual
                </span>
                <span className="font-bold text-[var(--on-surface)]">
                  {formatCurrency(compoundInterestTotal, currency, { showDecimals: true })}
                </span>
              </div>
              <div className="flex justify-between text-[var(--on-surface-variant)]">
                <span className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--secondary)]" />
                  Simple Accrual
                </span>
                <span className="font-bold text-[var(--on-surface)]">
                  {formatCurrency(simpleInterestTotal, currency, { showDecimals: true })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
