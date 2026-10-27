'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Chart, registerables } from 'chart.js';
import { Debt, Payment, Profile } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';
import { calculateDebtBalance, round2 } from '@/lib/utils/interest';
import { calculateTrustScore } from '@/lib/utils/trust-score';
import { isUPIMethod } from '@/lib/utils/upi-link';
import { Avatar } from '@/components/ui/Avatar';

Chart.register(...registerables);

interface AdminAnalyticsViewProps {
  debts: Debt[];
  payments: Payment[];
  profiles: Profile[];
  currency?: string;
}

export function AdminAnalyticsView({
  debts = [],
  payments = [],
  profiles = [],
  currency = 'inr',
}: AdminAnalyticsViewProps) {
  // Chart refs
  const volumeChartRef = useRef<HTMLCanvasElement | null>(null);
  const volumeChartInstance = useRef<Chart | null>(null);

  const statusChartRef = useRef<HTMLCanvasElement | null>(null);
  const statusChartInstance = useRef<Chart | null>(null);

  const methodChartRef = useRef<HTMLCanvasElement | null>(null);
  const methodChartInstance = useRef<Chart | null>(null);

  // Filter & control states
  const [timeRange, setTimeRange] = useState<'3M' | '6M' | '1Y'>('6M');
  const [statusMetricMode, setStatusMetricMode] = useState<'volume' | 'count'>('volume');
  const [themeKey, setThemeKey] = useState(0);

  // Listen for dark/light theme changes
  useEffect(() => {
    const handleThemeChange = () => setThemeKey((k) => k + 1);
    window.addEventListener('debtsync:theme_change', handleThemeChange);
    return () => window.removeEventListener('debtsync:theme_change', handleThemeChange);
  }, []);

  // --- Strict Scope Filtering: Only Active, Non-Purged Accounts ---
  // Excludes system tombstone (00000000-0000-0000-0000-000000000001) and purged accounts
  const activeProfiles = useMemo(() => {
    return profiles.filter(
      (p) => p.id !== '00000000-0000-0000-0000-000000000001' && !p.is_purged
    );
  }, [profiles]);

  const activeUserIds = useMemo(() => {
    return new Set(activeProfiles.map((p) => p.id));
  }, [activeProfiles]);

  const validDebts = useMemo(() => {
    return debts.filter(
      (d) =>
        activeUserIds.has(d.lender_id) &&
        activeUserIds.has(d.borrower_id) &&
        !d.purged_by_admin &&
        d.status !== 'purged'
    );
  }, [debts, activeUserIds]);

  const validDebtIds = useMemo(() => new Set(validDebts.map((d) => d.id)), [validDebts]);

  const validPayments = useMemo(() => {
    return payments.filter(
      (p) => validDebtIds.has(p.debt_id) && activeUserIds.has(p.paid_by)
    );
  }, [payments, validDebtIds, activeUserIds]);

  // --- Aggregated Financial & Settlement Metrics ---
  const metrics = useMemo(() => {
    let totalPrincipalVolume = 0;
    let settledPrincipalVolume = 0;
    let activePrincipalVolume = 0;
    let pendingPrincipalVolume = 0;
    let disputedPrincipalVolume = 0;

    let settledCount = 0;
    let activeCount = 0;
    let pendingCount = 0;
    let disputedCount = 0;
    let totalOutstandingVolume = 0;

    // Settlement Velocity: Calculate average days from creation to settlement
    const settlementDaysList: number[] = [];

    for (const d of validDebts) {
      const pAmt = Number(d.principal) || 0;
      totalPrincipalVolume += pAmt;

      if (d.status === 'settled') {
        settledCount++;
        settledPrincipalVolume += pAmt;

        // Calculate velocity
        const createdDate = new Date(d.created_at).getTime();
        const settledDate = d.settled_at ? new Date(d.settled_at).getTime() : createdDate;
        const diffDays = Math.max(0, Math.round((settledDate - createdDate) / (1000 * 60 * 60 * 24)));
        settlementDaysList.push(diffDays);
      } else if (d.status === 'active') {
        activeCount++;
        activePrincipalVolume += pAmt;
      } else if (d.status === 'pending') {
        pendingCount++;
        pendingPrincipalVolume += pAmt;
      } else if (d.status === 'disputed') {
        disputedCount++;
        disputedPrincipalVolume += pAmt;
      }

      // Outstanding balance on ongoing active or disputed agreements
      if (d.status === 'active' || d.status === 'disputed') {
        const dPayments = validPayments.filter((p) => p.debt_id === d.id);
        const calc = calculateDebtBalance(d, dPayments);
        totalOutstandingVolume += calc.currentBalance;
      }
    }

    const verifiedPayments = validPayments.filter((p) => p.is_verified);
    const unverifiedPayments = validPayments.filter((p) => !p.is_verified);
    const totalRepaymentsVolume = verifiedPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const pendingRepaymentsVolume = unverifiedPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    const avgSettlementDays =
      settlementDaysList.length > 0
        ? Math.round(
            (settlementDaysList.reduce((a, b) => a + b, 0) / settlementDaysList.length) * 10
          ) / 10
        : 0;

    // Settlement rate: Settled vs (Settled + Active)
    const totalResolvedOrActive = settledCount + activeCount;
    const settlementRate =
      totalResolvedOrActive > 0 ? Math.round((settledCount / totalResolvedOrActive) * 100) : 0;

    // Recovery ratio: Total repaid vs Total principal
    const recoveryRatio =
      totalPrincipalVolume > 0
        ? Math.min(100, Math.round((totalRepaymentsVolume / totalPrincipalVolume) * 100))
        : 0;

    // Average Network Trust Score (300 - 850 scale, -1 when unrated)
    const scores = activeProfiles.map((p) => {
      const uDebts = validDebts.filter((d) => d.lender_id === p.id || d.borrower_id === p.id);
      const uDebtIds = new Set(uDebts.map((d) => d.id));
      const uPayments = validPayments.filter((pm) => uDebtIds.has(pm.debt_id));
      return calculateTrustScore(uDebts, uPayments, p.id, {
        isIsolated: p.is_isolated,
        isVerified: p.is_verified,
      }).score;
    });
    const scoredUsers = scores.filter((s) => s > 0);
    const avgTrustScore =
      scoredUsers.length > 0
        ? Math.round(scoredUsers.reduce((a, b) => a + b, 0) / scoredUsers.length)
        : -1;

    // Average loan ticket size
    const avgLoanSize =
      validDebts.length > 0 ? Math.round(totalPrincipalVolume / validDebts.length) : 0;

    return {
      totalPrincipalVolume: round2(totalPrincipalVolume),
      settledPrincipalVolume: round2(settledPrincipalVolume),
      activePrincipalVolume: round2(activePrincipalVolume),
      pendingPrincipalVolume: round2(pendingPrincipalVolume),
      disputedPrincipalVolume: round2(disputedPrincipalVolume),
      totalOutstandingVolume: round2(totalOutstandingVolume),
      totalRepaymentsVolume: round2(totalRepaymentsVolume),
      pendingRepaymentsVolume: round2(pendingRepaymentsVolume),
      settledCount,
      activeCount,
      pendingCount,
      disputedCount,
      totalDebts: validDebts.length,
      avgSettlementDays,
      settlementRate,
      recoveryRatio,
      avgTrustScore,
      avgLoanSize,
      unverifiedPaymentsCount: unverifiedPayments.length,
      activeUsersCount: activeProfiles.length,
      isolatedCount: activeProfiles.filter((p) => p.is_isolated).length,
    };
  }, [validDebts, validPayments, activeProfiles]);

  // --- Monthly Cashflow & Lending Trend Data Generator ---
  const monthlyData = useMemo(() => {
    const numMonths = timeRange === '3M' ? 3 : timeRange === '6M' ? 6 : 12;
    const now = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const labels: string[] = [];
    const lendingVolume: number[] = [];
    const repaymentsVolume: number[] = [];
    const netVolume: number[] = [];

    for (let i = numMonths - 1; i >= 0; i--) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
      const monthLabel = `${monthNames[startOfMonth.getMonth()]} ${String(startOfMonth.getFullYear()).slice(-2)}`;
      labels.push(monthLabel);

      // Debts issued in this month
      let monthLent = 0;
      for (const d of validDebts) {
        if (d.status === 'declined' || d.status === 'purged') continue;
        const dDate = new Date(d.created_at);
        if (dDate >= startOfMonth && dDate <= endOfMonth) {
          monthLent += Number(d.principal) || 0;
        }
      }
      lendingVolume.push(Math.round(monthLent));

      // Payments verified in this month
      let monthRepaid = 0;
      for (const p of validPayments) {
        if (!p.is_verified) continue;
        const pDate = new Date(p.created_at);
        if (pDate >= startOfMonth && pDate <= endOfMonth) {
          monthRepaid += Number(p.amount) || 0;
        }
      }
      repaymentsVolume.push(Math.round(monthRepaid));
      netVolume.push(Math.round(monthLent - monthRepaid));
    }

    return { labels, lendingVolume, repaymentsVolume, netVolume };
  }, [validDebts, validPayments, timeRange]);

  // --- Payment Channel Methods Distribution ---
  const paymentMethodsData = useMemo(() => {
    let upiVolume = 0;
    let upiCount = 0;
    let bankVolume = 0;
    let bankCount = 0;
    let cashVolume = 0;
    let cashCount = 0;
    let otherVolume = 0;
    let otherCount = 0;

    for (const p of validPayments) {
      const amt = Number(p.amount) || 0;
      const m = (p.payment_method || '').toLowerCase();

      if (isUPIMethod(m) || m.includes('upi') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm')) {
        upiVolume += amt;
        upiCount++;
      } else if (m.includes('bank') || m.includes('neft') || m.includes('imps') || m.includes('transfer')) {
        bankVolume += amt;
        bankCount++;
      } else if (m.includes('cash')) {
        cashVolume += amt;
        cashCount++;
      } else {
        otherVolume += amt;
        otherCount++;
      }
    }

    const total = upiVolume + bankVolume + cashVolume + otherVolume || 1;
    return {
      channels: [
        { label: 'UPI (GPay/PhonePe/Paytm)', volume: Math.round(upiVolume), count: upiCount, color: '#06b6d4' },
        { label: 'Bank Transfer (IMPS/NEFT)', volume: Math.round(bankVolume), count: bankCount, color: '#3b82f6' },
        { label: 'Direct Cash', volume: Math.round(cashVolume), count: cashCount, color: '#10b981' },
        { label: 'Other Channels', volume: Math.round(otherVolume), count: otherCount, color: '#a855f7' },
      ],
      totalVolume: Math.round(total),
    };
  }, [validPayments]);

  // --- Top Active Participants by Volume ---
  const topCounterparties = useMemo(() => {
    const map = new Map<string, { profile: Profile; lentVolume: number; repaidVolume: number; settledCount: number }>();

    for (const p of activeProfiles) {
      map.set(p.id, { profile: p, lentVolume: 0, repaidVolume: 0, settledCount: 0 });
    }

    for (const d of validDebts) {
      const pAmt = Number(d.principal) || 0;
      const lenderEntry = map.get(d.lender_id);
      if (lenderEntry) {
        lenderEntry.lentVolume += pAmt;
        if (d.status === 'settled') lenderEntry.settledCount++;
      }
      const borrowerEntry = map.get(d.borrower_id);
      if (borrowerEntry && d.status === 'settled') {
        borrowerEntry.settledCount++;
      }
    }

    for (const p of validPayments) {
      if (!p.is_verified) continue;
      const payerEntry = map.get(p.paid_by);
      if (payerEntry) {
        payerEntry.repaidVolume += Number(p.amount) || 0;
      }
    }

    return Array.from(map.values())
      .filter((e) => e.lentVolume > 0 || e.repaidVolume > 0 || e.settledCount > 0)
      .sort((a, b) => b.lentVolume + b.repaidVolume - (a.lentVolume + a.repaidVolume))
      .slice(0, 5);
  }, [activeProfiles, validDebts, validPayments]);

  // --- Render Chart 1: Volume & Cashflow Trends ---
  useEffect(() => {
    if (!volumeChartRef.current) return;
    const ctx = volumeChartRef.current.getContext('2d');
    if (!ctx) return;

    if (volumeChartInstance.current) {
      volumeChartInstance.current.destroy();
      volumeChartInstance.current = null;
    }

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const tooltipBg = isDark ? '#0f172a' : '#ffffff';
    const tooltipText = isDark ? '#f8fafc' : '#0f172a';
    const tooltipBorder = isDark ? '#334155' : '#cbd5e1';

    // Gradients
    const gradLent = ctx.createLinearGradient(0, 0, 0, 260);
    gradLent.addColorStop(0, 'rgba(6, 182, 212, 0.4)');
    gradLent.addColorStop(1, 'rgba(6, 182, 212, 0.01)');

    const gradRepaid = ctx.createLinearGradient(0, 0, 0, 260);
    gradRepaid.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
    gradRepaid.addColorStop(1, 'rgba(16, 185, 129, 0.01)');

    volumeChartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: monthlyData.labels,
        datasets: [
          {
            label: 'New Debt Issued',
            data: monthlyData.lendingVolume,
            borderColor: '#06b6d4',
            backgroundColor: gradLent,
            fill: true,
            borderWidth: 2.5,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#06b6d4',
          },
          {
            label: 'Repayments Verified',
            data: monthlyData.repaymentsVolume,
            borderColor: '#10b981',
            backgroundColor: gradRepaid,
            fill: true,
            borderWidth: 2.5,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#10b981',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              color: textColor,
              font: { family: 'ui-monospace, SFMono-Regular, monospace', size: 11 },
            },
          },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: tooltipText,
            bodyColor: tooltipText,
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 10,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(Number(ctx.parsed.y) || 0, currency)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: textColor,
              font: { family: 'ui-monospace, SFMono-Regular, monospace', size: 10 },
            },
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: 'ui-monospace, SFMono-Regular, monospace', size: 10 },
              callback: (val) => `${currency.toUpperCase()} ${val}`,
            },
          },
        },
      },
    });

    return () => {
      if (volumeChartInstance.current) {
        volumeChartInstance.current.destroy();
        volumeChartInstance.current = null;
      }
    };
  }, [monthlyData, themeKey, currency]);

  // --- Render Chart 2: Status Distribution Doughnut ---
  useEffect(() => {
    if (!statusChartRef.current) return;
    const ctx = statusChartRef.current.getContext('2d');
    if (!ctx) return;

    if (statusChartInstance.current) {
      statusChartInstance.current.destroy();
      statusChartInstance.current = null;
    }

    const isDark = document.documentElement.classList.contains('dark');
    const tooltipBg = isDark ? '#0f172a' : '#ffffff';
    const tooltipText = isDark ? '#f8fafc' : '#0f172a';
    const tooltipBorder = isDark ? '#334155' : '#cbd5e1';

    const values =
      statusMetricMode === 'volume'
        ? [
            metrics.settledPrincipalVolume,
            metrics.activePrincipalVolume,
            metrics.pendingPrincipalVolume,
            metrics.disputedPrincipalVolume,
          ]
        : [metrics.settledCount, metrics.activeCount, metrics.pendingCount, metrics.disputedCount];

    // If completely empty, show fallback slice
    const totalVal = values.reduce((a, b) => a + b, 0);
    const dataVals = totalVal > 0 ? values : [1];
    const dataColors =
      totalVal > 0 ? ['#10b981', '#06b6d4', '#f59e0b', '#ef4444'] : ['rgba(148, 163, 184, 0.2)'];
    const dataLabels =
      totalVal > 0
        ? ['Settled', 'Active / Ongoing', 'Pending Approval', 'Disputed']
        : ['No Agreements'];

    statusChartInstance.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: dataLabels,
        datasets: [
          {
            data: dataVals,
            backgroundColor: dataColors,
            borderWidth: 2,
            borderColor: isDark ? '#0b1320' : '#ffffff',
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: tooltipText,
            bodyColor: tooltipText,
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 10,
            callbacks: {
              label: (ctx) => {
                if (totalVal === 0) return ' No recorded transactions';
                const v = Number(ctx.parsed) || 0;
                if (statusMetricMode === 'volume') {
                  return ` ${ctx.label}: ${formatCurrency(v, currency)} (${Math.round(
                    (v / totalVal) * 100
                  )}%)`;
                }
                return ` ${ctx.label}: ${v} agreements (${Math.round((v / totalVal) * 100)}%)`;
              },
            },
          },
        },
      },
    });

    return () => {
      if (statusChartInstance.current) {
        statusChartInstance.current.destroy();
        statusChartInstance.current = null;
      }
    };
  }, [metrics, statusMetricMode, themeKey, currency]);

  // --- Render Chart 3: Payment Methods Bar Chart ---
  useEffect(() => {
    if (!methodChartRef.current) return;
    const ctx = methodChartRef.current.getContext('2d');
    if (!ctx) return;

    if (methodChartInstance.current) {
      methodChartInstance.current.destroy();
      methodChartInstance.current = null;
    }

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const tooltipBg = isDark ? '#0f172a' : '#ffffff';
    const tooltipText = isDark ? '#f8fafc' : '#0f172a';
    const tooltipBorder = isDark ? '#334155' : '#cbd5e1';

    const labels = paymentMethodsData.channels.map((c) => c.label);
    const volumes = paymentMethodsData.channels.map((c) => c.volume);
    const bgColors = paymentMethodsData.channels.map((c) => c.color);

    methodChartInstance.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            data: volumes,
            backgroundColor: bgColors,
            borderRadius: 8,
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: tooltipText,
            bodyColor: tooltipText,
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 10,
            callbacks: {
              label: (ctx) => ` Volume: ${formatCurrency(Number(ctx.parsed.x) || 0, currency)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: 'ui-monospace, SFMono-Regular, monospace', size: 10 },
              callback: (val) => `${currency.toUpperCase()} ${val}`,
            },
          },
          y: {
            grid: { display: false },
            ticks: {
              color: textColor,
              font: { family: 'ui-monospace, SFMono-Regular, monospace', size: 10 },
            },
          },
        },
      },
    });

    return () => {
      if (methodChartInstance.current) {
        methodChartInstance.current.destroy();
        methodChartInstance.current = null;
      }
    };
  }, [paymentMethodsData, themeKey, currency]);

  return (
    <div className="space-y-6">
      {/* Scope & Audit Filter Header */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-cyan-500/10 via-indigo-500/5 to-transparent border border-cyan-500/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 text-cyan-500 flex items-center justify-center shrink-0 mt-0.5">
            <span className="material-symbols-outlined text-[22px]">verified</span>
          </div>
          <div>
            <h3 className="font-heading font-bold text-sm sm:text-base text-[var(--on-surface)] flex items-center gap-2">
              <span>Platform Financial Analytics</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-500 border border-cyan-500/30">
                ACTIVE ACCOUNTS ONLY
              </span>
            </h3>
            <p className="text-xs text-[var(--on-surface-variant)] mt-0.5 font-mono">
              Excluded purged accounts, test tombstones (0000...0001), and anonymized records to maintain strict ledger integrity.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap font-mono text-xs">
          <div className="px-3 py-1.5 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 text-[var(--on-surface)]">
            <span className="text-[var(--outline)]">Users: </span>
            <span className="font-bold text-cyan-500">{metrics.activeUsersCount}</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 text-[var(--on-surface)]">
            <span className="text-[var(--outline)]">Debts: </span>
            <span className="font-bold text-indigo-400">{metrics.totalDebts}</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 text-[var(--on-surface)]">
            <span className="text-[var(--outline)]">Settled: </span>
            <span className="font-bold text-emerald-500">{metrics.settledCount}</span>
          </div>
        </div>
      </div>

      {/* Primary KPI Grid (6 Metric Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {/* Card 1: Settled Principal */}
        <div className="p-4 rounded-2xl bg-[var(--surface-container-lowest)] border border-emerald-500/20 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-emerald-500 uppercase tracking-wider font-semibold">
              Settled Volume
            </span>
            <span className="material-symbols-outlined text-[18px] text-emerald-500">task_alt</span>
          </div>
          <div className="font-heading text-xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(metrics.settledPrincipalVolume, currency)}
          </div>
          <div className="text-[11px] text-[var(--outline)] font-mono flex items-center justify-between">
            <span>{metrics.settledCount} settled contracts</span>
            <span className="text-emerald-500 font-bold">{metrics.settlementRate}%</span>
          </div>
        </div>

        {/* Card 2: Active Outstanding */}
        <div className="p-4 rounded-2xl bg-[var(--surface-container-lowest)] border border-cyan-500/20 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-cyan-500 uppercase tracking-wider font-semibold">
              Active Outstanding
            </span>
            <span className="material-symbols-outlined text-[18px] text-cyan-500">sync_alt</span>
          </div>
          <div className="font-heading text-xl font-bold text-[var(--on-surface)]">
            {formatCurrency(metrics.totalOutstandingVolume, currency)}
          </div>
          <div className="text-[11px] text-[var(--outline)] font-mono flex items-center justify-between">
            <span>{metrics.activeCount} active agreements</span>
            <span className="text-cyan-500 font-bold">Circulating</span>
          </div>
        </div>

        {/* Card 3: Verified Repayments */}
        <div className="p-4 rounded-2xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
              Verified Repayments
            </span>
            <span className="material-symbols-outlined text-[18px] text-emerald-500">payments</span>
          </div>
          <div className="font-heading text-xl font-bold text-[var(--on-surface)]">
            {formatCurrency(metrics.totalRepaymentsVolume, currency)}
          </div>
          <div className="text-[11px] text-[var(--outline)] font-mono flex items-center justify-between">
            <span>Repayment Ratio</span>
            <span className="text-emerald-500 font-bold">{metrics.recoveryRatio}%</span>
          </div>
        </div>

        {/* Card 4: Settlement Velocity */}
        <div className="p-4 rounded-2xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
              Settlement Velocity
            </span>
            <span className="material-symbols-outlined text-[18px] text-amber-500">speed</span>
          </div>
          <div className="font-heading text-xl font-bold text-[var(--on-surface)]">
            {metrics.avgSettlementDays} <span className="text-xs font-normal text-[var(--outline)]">days</span>
          </div>
          <div className="text-[11px] text-[var(--outline)] font-mono">
            Average days to full payoff
          </div>
        </div>

        {/* Card 5: Total Committed Principal */}
        <div className="p-4 rounded-2xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
              Total Principal
            </span>
            <span className="material-symbols-outlined text-[18px] text-indigo-400">account_balance_wallet</span>
          </div>
          <div className="font-heading text-xl font-bold text-[var(--on-surface)]">
            {formatCurrency(metrics.totalPrincipalVolume, currency)}
          </div>
          <div className="text-[11px] text-[var(--outline)] font-mono">
            Avg ticket: {formatCurrency(metrics.avgLoanSize, currency)}
          </div>
        </div>

        {/* Card 6: Network Trust Index */}
        <div className="p-4 rounded-2xl bg-[var(--surface-container-lowest)] border border-purple-500/20 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-purple-400 uppercase tracking-wider font-semibold">
              Network Trust Index
            </span>
            <span className="material-symbols-outlined text-[18px] text-purple-400">shield</span>
          </div>
          <div className="font-heading text-xl font-bold text-purple-600 dark:text-purple-400">
            {metrics.avgTrustScore > 0 ? (
              <>
                {metrics.avgTrustScore}{' '}
                <span className="text-xs font-normal text-[var(--outline)]">/ 850</span>
              </>
            ) : (
              <span className="text-[var(--outline)]">-1 (Unrated)</span>
            )}
          </div>
          <div className="text-[11px] text-[var(--outline)] font-mono flex items-center justify-between">
            <span>Disputes: {metrics.disputedCount}</span>
            <span className="text-purple-400 font-bold">{metrics.isolatedCount} Isolated</span>
          </div>
        </div>
      </div>

      {/* Main Charts Section (2 Columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 spans): Financial Volume Trends */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="font-heading font-bold text-sm text-[var(--on-surface)] flex items-center gap-2">
                <span>Platform Cashflow &amp; Lending Volume</span>
              </h4>
              <p className="text-[11px] text-[var(--outline)] font-mono mt-0.5">
                New agreements issued vs verified settlements across monthly windows
              </p>
            </div>

            {/* Timeframe selector */}
            <div className="flex items-center gap-1 bg-[var(--surface-container)] p-1 rounded-xl self-start sm:self-auto font-mono text-xs">
              {(['3M', '6M', '1Y'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setTimeRange(r)}
                  className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    timeRange === r
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-sm'
                      : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Chart Canvas */}
          <div className="h-64 sm:h-72 w-full relative">
            <canvas ref={volumeChartRef} />
          </div>

          <div className="pt-2 border-t border-[var(--outline-variant)]/20 grid grid-cols-3 gap-2 text-center font-mono text-xs">
            <div>
              <span className="text-[10px] text-[var(--outline)] block">Total Lent in Period</span>
              <span className="font-bold text-cyan-500">
                {formatCurrency(
                  monthlyData.lendingVolume.reduce((a, b) => a + b, 0),
                  currency
                )}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-[var(--outline)] block">Total Repaid in Period</span>
              <span className="font-bold text-emerald-500">
                {formatCurrency(
                  monthlyData.repaymentsVolume.reduce((a, b) => a + b, 0),
                  currency
                )}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-[var(--outline)] block">Net Ledger Balance</span>
              <span className="font-bold text-[var(--on-surface)]">
                {formatCurrency(
                  monthlyData.netVolume.reduce((a, b) => a + b, 0),
                  currency
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Status & Distribution Doughnut */}
        <div className="p-5 rounded-2xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-heading font-bold text-sm text-[var(--on-surface)]">
                Agreement Status Breakdown
              </h4>
              <div className="flex items-center gap-1 bg-[var(--surface-container)] p-0.5 rounded-lg font-mono text-[10px]">
                <button
                  type="button"
                  onClick={() => setStatusMetricMode('volume')}
                  className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                    statusMetricMode === 'volume'
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] font-bold'
                      : 'text-[var(--on-surface-variant)]'
                  }`}
                >
                  Volume
                </button>
                <button
                  type="button"
                  onClick={() => setStatusMetricMode('count')}
                  className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                    statusMetricMode === 'count'
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] font-bold'
                      : 'text-[var(--on-surface-variant)]'
                  }`}
                >
                  Count
                </button>
              </div>
            </div>
            <p className="text-[11px] text-[var(--outline)] font-mono mt-0.5">
              Proportion of settled, ongoing, and pending debts
            </p>
          </div>

          {/* Doughnut Canvas with Centered Overlay */}
          <div className="relative h-48 w-full flex items-center justify-center my-2">
            <canvas ref={statusChartRef} />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="font-heading font-extrabold text-xl text-[var(--on-surface)]">
                {metrics.settlementRate}%
              </span>
              <span className="text-[9px] font-mono text-[var(--outline)] uppercase tracking-wider">
                Settled Rate
              </span>
            </div>
          </div>

          {/* Custom Status Legend */}
          <div className="space-y-1.5 font-mono text-xs pt-2 border-t border-[var(--outline-variant)]/20">
            <div className="flex items-center justify-between text-emerald-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                Settled
              </span>
              <span className="font-bold">
                {statusMetricMode === 'volume'
                  ? formatCurrency(metrics.settledPrincipalVolume, currency)
                  : `${metrics.settledCount} debts`}
              </span>
            </div>
            <div className="flex items-center justify-between text-cyan-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 inline-block" />
                Active / Current
              </span>
              <span className="font-bold">
                {statusMetricMode === 'volume'
                  ? formatCurrency(metrics.activePrincipalVolume, currency)
                  : `${metrics.activeCount} debts`}
              </span>
            </div>
            <div className="flex items-center justify-between text-amber-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                Pending Acceptance
              </span>
              <span className="font-bold">
                {statusMetricMode === 'volume'
                  ? formatCurrency(metrics.pendingPrincipalVolume, currency)
                  : `${metrics.pendingCount} debts`}
              </span>
            </div>
            {metrics.disputedCount > 0 && (
              <div className="flex items-center justify-between text-red-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                  Disputed
                </span>
                <span className="font-bold">
                  {statusMetricMode === 'volume'
                    ? formatCurrency(metrics.disputedPrincipalVolume, currency)
                    : `${metrics.disputedCount} debts`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Secondary Analytics Row: Payment Channels & Top Counterparties */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Channels Breakdown */}
        <div className="p-5 rounded-2xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 shadow-sm space-y-4">
          <div>
            <h4 className="font-heading font-bold text-sm text-[var(--on-surface)] flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-cyan-500">qr_code_2</span>
              <span>Settlement Rails &amp; Payment Methods</span>
            </h4>
            <p className="text-[11px] text-[var(--outline)] font-mono mt-0.5">
              Verified settlement volume split across UPI, direct bank transfers, and cash
            </p>
          </div>

          <div className="h-44 w-full relative">
            <canvas ref={methodChartRef} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--outline-variant)]/20 font-mono text-[11px]">
            {paymentMethodsData.channels.map((c) => (
              <div key={c.label} className="p-2 rounded-xl bg-[var(--surface-container)] space-y-0.5">
                <span className="text-[10px] text-[var(--outline)] block truncate">{c.label}</span>
                <span className="font-bold text-[var(--on-surface)] block">
                  {formatCurrency(c.volume, currency)}
                </span>
                <span className="text-[9px] text-[var(--outline)]">{c.count} txns</span>
              </div>
            ))}
          </div>
        </div>

        {/* Counterparty Network Concentration */}
        <div className="p-5 rounded-2xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <h4 className="font-heading font-bold text-sm text-[var(--on-surface)] flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-purple-400">group</span>
              <span>Top Active Network Counterparties</span>
            </h4>
            <p className="text-[11px] text-[var(--outline)] font-mono mt-0.5">
              Highest volume active participants with clean settlement track records
            </p>
          </div>

          <div className="divide-y divide-[var(--outline-variant)]/10 font-mono text-xs">
            {topCounterparties.length === 0 ? (
              <div className="py-8 text-center text-[var(--outline)]">
                No active counterparty transactions to display.
              </div>
            ) : (
              topCounterparties.map(({ profile, lentVolume, repaidVolume, settledCount }) => (
                <div key={profile.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar
                      src={profile.avatar_url}
                      name={profile.full_name || profile.email}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <span className="font-bold text-[var(--on-surface)] block truncate">
                        {profile.full_name || profile.email}
                      </span>
                      <span className="text-[10px] text-[var(--outline)] block truncate">
                        {profile.email}
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="font-bold text-[var(--on-surface)] block">
                      {formatCurrency(lentVolume + repaidVolume, currency)}
                    </span>
                    <span className="text-[10px] text-emerald-500 font-semibold block">
                      {settledCount} settled
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-between text-xs font-mono">
            <span className="text-purple-400">Platform Liquidity Ratio:</span>
            <span className="font-bold text-purple-300">
              {metrics.totalPrincipalVolume > 0
                ? `${Math.round((metrics.totalRepaymentsVolume / metrics.totalPrincipalVolume) * 100)}% Recovered`
                : '100%'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
