'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { Debt, Payment } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';
import { generateCashflowData, generatePortfolioGrowthData } from '@/lib/utils/chart-data';

Chart.register(...registerables);

interface CashflowChartProps {
  debts?: Debt[];
  payments?: Payment[];
  currentUserId?: string | null;
  currency?: string;
}

export function CashflowChart({
  debts = [],
  payments = [],
  currentUserId = '',
  currency = 'inr',
}: CashflowChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  const [viewMode, setViewMode] = useState<'growth' | 'cashflow'>('growth');
  const [projDays, setProjDays] = useState<30 | 90 | 365>(30);
  const [cashflowPeriod, setCashflowPeriod] = useState<'1M' | '3M' | '1Y'>('3M');

  const activeDebts = debts.filter((d) => d.status !== 'declined');

  // Compute real data
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    const handleThemeChange = () => setThemeKey((k) => k + 1);
    window.addEventListener('debtsync:theme_change', handleThemeChange);
    return () => window.removeEventListener('debtsync:theme_change', handleThemeChange);
  }, []);

  const growthData = generatePortfolioGrowthData(
    activeDebts,
    payments,
    currentUserId || '',
    projDays
  );

  const cashflowData = generateCashflowData(
    activeDebts,
    payments,
    currentUserId || '',
    cashflowPeriod
  );

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#9198a1' : '#6f797a';
    const tooltipBg = isDark ? '#1c2128' : '#ffffff';
    const tooltipText = isDark ? '#e6edf3' : '#131c28';
    const tooltipBorder = isDark ? '#30363d' : '#bfc8c9';

    if (viewMode === 'growth') {
      // Linear Gradients for Area Fill
      const gradLent = ctx.createLinearGradient(0, 0, 0, 300);
      gradLent.addColorStop(0, isDark ? 'rgba(52, 211, 153, 0.35)' : 'rgba(0, 106, 105, 0.25)');
      gradLent.addColorStop(1, 'rgba(52, 211, 153, 0.0)');

      const gradOwed = ctx.createLinearGradient(0, 0, 0, 300);
      gradOwed.addColorStop(0, isDark ? 'rgba(248, 113, 113, 0.30)' : 'rgba(186, 26, 26, 0.20)');
      gradOwed.addColorStop(1, 'rgba(248, 113, 113, 0.0)');

      chartInstanceRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: growthData.labels,
          datasets: [
            {
              label: 'Owed to You (Historical)',
              data: growthData.historicalOwedToYou,
              borderColor: isDark ? '#34d399' : '#006a69',
              backgroundColor: gradLent,
              fill: true,
              borderWidth: 2.5,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHoverBackgroundColor: isDark ? '#34d399' : '#006a69',
              spanGaps: false,
            },
            {
              label: 'Owed to You (Projected)',
              data: growthData.projectedOwedToYou,
              borderColor: isDark ? '#34d399' : '#006a69',
              borderDash: [6, 4],
              borderWidth: 2,
              fill: false,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 5,
              spanGaps: false,
            },
            {
              label: 'You Owe (Historical)',
              data: growthData.historicalYouOwe,
              borderColor: isDark ? '#f87171' : '#ba1a1a',
              backgroundColor: gradOwed,
              fill: true,
              borderWidth: 2.5,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHoverBackgroundColor: isDark ? '#f87171' : '#ba1a1a',
              spanGaps: false,
            },
            {
              label: 'You Owe (Projected)',
              data: growthData.projectedYouOwe,
              borderColor: isDark ? '#f87171' : '#ba1a1a',
              borderDash: [6, 4],
              borderWidth: 2,
              fill: false,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 5,
              spanGaps: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              backgroundColor: tooltipBg,
              titleColor: tooltipText,
              bodyColor: tooltipText,
              borderColor: tooltipBorder,
              borderWidth: 1,
              padding: 10,
              boxPadding: 4,
              bodyFont: { family: 'JetBrains Mono', size: 12 },
              titleFont: { family: 'Hanken Grotesk', weight: 'bold', size: 13 },
              callbacks: {
                label: (context) => {
                  const val = context.parsed.y;
                  if (val === null || val === undefined) return '';
                  const dsLabel = context.dataset.label || '';
                  const cleanLabel = dsLabel.replace(' (Historical)', '').replace(' (Projected)', '');
                  const isProj = dsLabel.includes('(Projected)');
                  return `${cleanLabel}: ${formatCurrency(val, currency, { showDecimals: true })}${isProj ? ' (Proj)' : ''}`;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: 'JetBrains Mono', size: 10 },
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 7,
                autoSkipPadding: 16,
              },
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: 'JetBrains Mono', size: 11 },
                callback: (v) => formatCurrency(Number(v), currency),
              },
            },
          },
        },
      });
    } else {
      // Cashflow Bar Chart
      chartInstanceRef.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: cashflowData.map((d) => d.label),
          datasets: [
            {
              label: 'Money In (Repayments)',
              data: cashflowData.map((d) => d.moneyIn),
              backgroundColor: isDark ? 'rgba(52, 211, 153, 0.85)' : 'rgba(0, 106, 105, 0.85)',
              borderRadius: 6,
              borderSkipped: false,
            },
            {
              label: 'Money Out (Loans)',
              data: cashflowData.map((d) => d.moneyOut),
              backgroundColor: isDark ? 'rgba(56, 217, 217, 0.75)' : 'rgba(0, 67, 73, 0.75)',
              borderRadius: 6,
              borderSkipped: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              backgroundColor: tooltipBg,
              titleColor: tooltipText,
              bodyColor: tooltipText,
              borderColor: tooltipBorder,
              borderWidth: 1,
              padding: 10,
              boxPadding: 4,
              bodyFont: { family: 'JetBrains Mono', size: 12 },
              titleFont: { family: 'Hanken Grotesk', weight: 'bold', size: 13 },
              callbacks: {
                label: (context) => {
                  const val = context.parsed.y;
                  return `${context.dataset.label}: ${formatCurrency(Number(val), currency)}`;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: 'JetBrains Mono', size: 10 },
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 7,
                autoSkipPadding: 16,
              },
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: 'JetBrains Mono', size: 11 },
                callback: (v) => formatCurrency(Number(v), currency),
              },
            },
          },
        },
      });
    }

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [viewMode, projDays, cashflowPeriod, growthData, cashflowData, currency, themeKey]);

  return (
    <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 flex flex-col h-[400px] shadow-sm">
      {/* Header with Title, Mode Switcher & Timeframe Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-heading text-lg md:text-xl font-bold text-[var(--on-surface)]">
              {viewMode === 'growth' ? 'Portfolio Growth & Projection' : 'Cashflow Movement'}
            </h3>
            {viewMode === 'growth' && growthData.hasActiveInterest && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Interest
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
            {viewMode === 'growth'
              ? 'Historical balances with continuous compound interest projection'
              : 'Money In (Repayments collected) vs Money Out (Loans disbursed)'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Mode Selector */}
          <div className="flex bg-[var(--surface-container)] p-0.5 rounded-xl border border-[var(--outline-variant)]/20">
            <button
              onClick={() => setViewMode('growth')}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg transition-all ${
                viewMode === 'growth'
                  ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-xs'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              Growth
            </button>
            <button
              onClick={() => setViewMode('cashflow')}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg transition-all ${
                viewMode === 'cashflow'
                  ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-xs'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              Cashflow
            </button>
          </div>

          {/* Timeframe Selector */}
          {viewMode === 'growth' ? (
            <div className="flex bg-[var(--surface-container)] p-0.5 rounded-xl border border-[var(--outline-variant)]/20">
              {([30, 90, 365] as const).map((days) => (
                <button
                  key={days}
                  onClick={() => setProjDays(days)}
                  className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg transition-all ${
                    projDays === days
                      ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-xs'
                      : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                  }`}
                >
                  {days === 365 ? '1Y' : `${days}D`}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex bg-[var(--surface-container)] p-0.5 rounded-xl border border-[var(--outline-variant)]/20">
              {(['1M', '3M', '1Y'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setCashflowPeriod(p)}
                  className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg transition-all ${
                    cashflowPeriod === p
                      ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-xs'
                      : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="flex-1 relative w-full h-full min-h-[220px]">
        <canvas ref={canvasRef} />
      </div>

      {/* Legend Footer */}
      <div className="flex flex-wrap items-center justify-between text-xs font-mono text-[var(--on-surface-variant)] mt-3 pt-2 border-t border-[var(--outline-variant)]/15 gap-2">
        {viewMode === 'growth' ? (
          <>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-1 bg-[var(--secondary)] rounded-full" />
                <span>Owed to You</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-1 bg-[var(--error)] rounded-full" />
                <span>You Owe</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[var(--on-surface-variant)]">
              <span className="inline-block w-4 border-b-2 border-dashed border-[var(--outline)]" />
              <span>Dashed line = Future Compounding Projection</span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-[var(--secondary)] rounded-xs" />
              <span>Money In (Repayments Received)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-[var(--primary)] rounded-xs" />
              <span>Money Out (Loans Given)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
