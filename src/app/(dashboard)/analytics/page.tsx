'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance, round2 } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { CashflowChart } from '@/components/dashboard/CashflowChart';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { getLedgerCache, setLedgerCache } from '@/lib/stores/ledger-store';
import { SkeletonBalanceCards } from '@/components/ui/Skeleton';
import { calculateTrustScore } from '@/lib/utils/trust-score';
import { PAYMENT_METHOD_LABELS } from '@/lib/utils/upi-link';

export default function AnalyticsPage() {
  const supabase = createClient();

  const initialCache = getLedgerCache();
  const [loading, setLoading] = useState(!initialCache);
  const [currency, setCurrency] = useState(initialCache?.currency || 'inr');
  const [currentUserId, setCurrentUserId] = useState<string | null>(initialCache?.userId || null);
  const [debts, setDebts] = useState<Debt[]>(initialCache?.debts || []);
  const [payments, setPayments] = useState<Payment[]>(initialCache?.payments || []);
  const [showTrustDetails, setShowTrustDetails] = useState(false);

  const fetchAnalyticsData = useCallback(async () => {
    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) return;
      setCurrentUserId(user.id);

      const [settingsRes, debtRowsRes] = await Promise.all([
        supabase
          .from('user_settings')
          .select('default_currency')
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('debts')
          .select(`
            *,
            lender:profiles!debts_lender_id_fkey(id, email, full_name),
            borrower:profiles!debts_borrower_id_fkey(id, email, full_name)
          `)
          .or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`),
      ]);

      const activeCurrency = settingsRes.data?.default_currency || currency;
      if (settingsRes.data?.default_currency) setCurrency(settingsRes.data.default_currency);

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

  // Aggregate metrics
  let totalLent = 0;
  let totalOwed = 0;
  let interestAccrued = 0;
  let simpleInterestTotal = 0;
  let compoundInterestTotal = 0;
  let totalRepaymentsReceived = 0;
  let totalRepaymentsMade = 0;
  let settledDebtsCount = 0;

  for (const d of debts) {
    if (d.status === 'settled') settledDebtsCount++;
    if (d.status === 'declined') continue;

    const debtPayments = payments.filter((p) => p.debt_id === d.id);
    const calc = calculateDebtBalance(d, debtPayments);

    if (d.lender_id === currentUserId) {
      totalLent += calc.currentBalance;
      interestAccrued += calc.totalAccruedInterest;
      totalRepaymentsReceived += calc.totalPaid;
    } else {
      totalOwed += calc.currentBalance;
      totalRepaymentsMade += calc.totalPaid;
    }

    if (d.interest_type === 'simple') simpleInterestTotal += calc.totalAccruedInterest;
    if (d.interest_type === 'compound') compoundInterestTotal += calc.totalAccruedInterest;
  }

  totalLent = round2(totalLent);
  totalOwed = round2(totalOwed);
  interestAccrued = round2(interestAccrued);
  simpleInterestTotal = round2(simpleInterestTotal);
  compoundInterestTotal = round2(compoundInterestTotal);
  totalRepaymentsReceived = round2(totalRepaymentsReceived);
  totalRepaymentsMade = round2(totalRepaymentsMade);
  const netPosition = round2(totalLent - totalOwed);

  // Real Repayment Velocity:
  // % of total obligations that have been successfully repaid
  const grandObligations = totalLent + totalRepaymentsReceived;
  const repaymentVelocityPercent = grandObligations > 0
    ? Math.min(100, Math.round((totalRepaymentsReceived / grandObligations) * 100))
    : debts.length === 0 ? 100 : 85;

  // Comprehensive Network Trust Score Breakdown & Performance Factors
  const trustBreakdown = calculateTrustScore(debts, payments, currentUserId || undefined);
  const trustScore = trustBreakdown.score;
  const trustRating = trustBreakdown.rating;
  const trustRatingColor = trustBreakdown.ratingColor;
  const trustFactors = trustBreakdown.factors;
  const trustTips = trustBreakdown.tips;

  // Payment Channel & Methods Distribution
  const paymentMethodsStats: Record<string, { count: number; volume: number }> = {};
  for (const p of payments) {
    if (!p.is_verified) continue;
    const mode = p.payment_method || 'other';
    if (!paymentMethodsStats[mode]) {
      paymentMethodsStats[mode] = { count: 0, volume: 0 };
    }
    paymentMethodsStats[mode].count += 1;
    paymentMethodsStats[mode].volume = round2(paymentMethodsStats[mode].volume + (Number(p.amount) || 0));
  }

  // Debt Age Distribution
  const ageBuckets = { '0-30d': 0, '31-60d': 0, '61-90d': 0, '91-120d': 0, '>120d': 0 };
  const now = Date.now();
  for (const d of debts) {
    if (d.status === 'declined' || d.status === 'settled') continue;
    const days = Math.floor((now - new Date(d.created_at).getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 30) ageBuckets['0-30d'] += Number(d.principal);
    else if (days <= 60) ageBuckets['31-60d'] += Number(d.principal);
    else if (days <= 90) ageBuckets['61-90d'] += Number(d.principal);
    else if (days <= 120) ageBuckets['91-120d'] += Number(d.principal);
    else ageBuckets['>120d'] += Number(d.principal);
  }

  const maxBucketVal = Math.max(...Object.values(ageBuckets), 1000);

  // Dynamic 6-month Liquidity Forecast
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const nowMonth = new Date().getMonth();
  const liquidityForecast = Array.from({ length: 6 }).map((_, idx) => {
    const monthIndex = (nowMonth + 1 + idx) % 12;
    const month = monthNames[monthIndex];
    const baseInflow = totalLent > 0 ? (totalLent / 6) * (1 + idx * 0.05) : 0;
    const baseRisk = totalLent > 0 ? -(totalLent * 0.02 * (idx + 1)) : 0;
    return {
      month,
      inflow: Math.round(baseInflow),
      riskAdj: Math.round(baseRisk),
      status: idx < 2 ? 'High Certainty' : 'Moderate',
    };
  });

  return (
    <div className="page-enter space-y-6 md:space-y-8">
      {/* Title */}
      <div>
        <h1 className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)]">
          Analytics & Performance Hub
        </h1>
        <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-1">
          Comprehensive portfolio health, repayment velocity, and liquidity forecast
        </p>
      </div>

      {/* Top 4 Summary Cards */}
      {loading && debts.length === 0 ? (
        <SkeletonBalanceCards />
      ) : (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[var(--surface-container-lowest)] p-5 rounded-2xl border border-[var(--outline-variant)]/30 shadow-sm">
            <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
              Total Lent
            </span>
            <div className="font-heading text-2xl font-bold text-[var(--on-surface)] mt-2">
              {formatCurrency(totalLent, currency)}
            </div>
          </div>

          <div className="bg-[var(--surface-container-lowest)] p-5 rounded-2xl border border-[var(--outline-variant)]/30 shadow-sm">
            <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
              Total Owed
            </span>
            <div className="font-heading text-2xl font-bold text-[var(--error)] mt-2">
              {formatCurrency(totalOwed, currency)}
            </div>
          </div>

          <div className="bg-[var(--primary)] text-[var(--on-primary)] p-5 rounded-2xl shadow-md">
            <span className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-primary-container)]">
              Net Position
            </span>
            <div className="font-heading text-2xl font-bold mt-2">
              {formatCurrency(netPosition, currency)}
            </div>
          </div>

          <div className="bg-[var(--surface-container-lowest)] p-5 rounded-2xl border border-[var(--outline-variant)]/30 shadow-sm">
            <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
              Interest Accrued
            </span>
            <div className="font-heading text-2xl font-bold text-[var(--secondary)] mt-2">
              +{formatCurrency(interestAccrued, currency, { showDecimals: true })}
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
        {/* Left: Net Flow & Age Distribution */}
        <div className="lg:col-span-8 space-y-6">
          {/* Debt Age Distribution */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Debt Age Distribution
                </h3>
                <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
                  Outstanding principal grouped by maturity duration
                </p>
              </div>
              <span className="font-mono text-xs text-[var(--on-surface-variant)] bg-[var(--surface-container)] px-3 py-1 rounded-lg">
                Outstanding Time
              </span>
            </div>

            <div className="h-44 flex items-end gap-4 pt-4 border-b border-[var(--outline-variant)]/20 pb-2">
              {Object.entries(ageBuckets).map(([bucket, amount], idx) => {
                const heightPercent = Math.max(12, (amount / maxBucketVal) * 100);
                const isOverdueRisk = idx >= 3;
                return (
                  <div key={bucket} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                    <div
                      className={`w-full rounded-t transition-all ${
                        isOverdueRisk ? 'bg-[var(--error)]/70 hover:bg-[var(--error)]' : 'bg-[var(--secondary)]/80 hover:bg-[var(--secondary)]'
                      }`}
                      style={{ height: `${heightPercent}%` }}
                      title={`${bucket}: ${formatCurrency(amount, currency)}`}
                    />
                    <span className="font-mono text-xs text-[var(--on-surface-variant)] font-semibold">
                      {bucket}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 6-Month Liquidity Forecast Table */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm">
            <h3 className="font-heading text-lg font-bold text-[var(--on-surface)] mb-4">
              6-Month Liquidity Forecast
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-body-md text-xs">
                <thead>
                  <tr className="border-b border-[var(--outline-variant)]/20 font-mono text-[var(--on-surface-variant)] uppercase">
                    <th className="pb-3 font-semibold">Month</th>
                    <th className="pb-3 font-semibold">Expected Inflow</th>
                    <th className="pb-3 font-semibold">Risk Adj.</th>
                    <th className="pb-3 font-semibold text-right">Certainty</th>
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
                        {formatCurrency(row.riskAdj, currency)}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            row.status === 'High Certainty'
                              ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
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
              {['upi', 'bank_transfer', 'cash', 'gpay', 'phonepe', 'paytm', 'other'].map((mode) => {
                const meta = PAYMENT_METHOD_LABELS[mode];
                const stats = paymentMethodsStats[mode] || { count: 0, volume: 0 };
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
          </div>
        </div>

        {/* Right: Trust Score & Velocity */}
        <div className="lg:col-span-4 space-y-6">
          {/* Trust Score Card matching Stitch with Factor Breakdown */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-container-high)] text-[var(--primary)] flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-[22px]">verified_user</span>
            </div>
            <span className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)]">
              Network Trust Score
            </span>

            {/* Geometric diamond badge */}
            <div className="my-6 relative w-36 h-36 flex items-center justify-center">
              <div className="absolute inset-0 border-2 border-[var(--primary)] rotate-45 rounded-2xl" />
              <div className="relative z-10 flex flex-col items-center">
                <span className="font-numeric-ticker text-4xl font-bold text-[var(--on-surface)]">
                  {trustScore}
                </span>
                <span className={`font-mono text-xs font-bold uppercase mt-0.5 ${trustRatingColor}`}>
                  {trustRating}
                </span>
              </div>
            </div>

            <p className="font-mono text-xs text-[var(--on-surface-variant)] leading-relaxed mb-4">
              Calculated dynamically from {settledDebtsCount} settled cycles, {repaymentVelocityPercent}% repayment velocity, and on-time records.
            </p>

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
                    <li>Settle active debts to earn +25 points per debt.</li>
                    <li>Settle on or before the due date for a +15 point on-time bonus.</li>
                    <li>Maintain repayment velocity ≥ 80% to retain the +30 velocity bonus.</li>
                  </ul>
                </div>

                {/* Actions that Lower Score */}
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400 font-mono text-[11px] font-bold uppercase tracking-wider">
                    <span className="material-symbols-outlined text-[15px]">warning</span>
                    <span>What Lowers Your Score</span>
                  </div>
                  <ul className="text-[11px] font-mono text-[var(--on-surface)] space-y-1 pl-4 list-disc marker:text-red-500">
                    <li>Declining debt requests incurs a -40 point penalty each.</li>
                    <li>Unresolved disputed payments penalize -20 points.</li>
                    <li>Settling past the agreed due date costs -10 points.</li>
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
