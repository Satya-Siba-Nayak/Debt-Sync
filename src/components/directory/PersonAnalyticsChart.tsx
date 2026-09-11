'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { Debt, Payment } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';
import { generatePersonGrowthData } from '@/lib/utils/chart-data';

Chart.register(...registerables);

interface PersonAnalyticsChartProps {
  debts: Debt[];
  payments: Payment[];
  currentUserId: string;
  currency?: string;
  personName?: string;
}

export function PersonAnalyticsChart({
  debts,
  payments,
  currentUserId,
  currency = 'inr',
  personName = 'Counterparty',
}: PersonAnalyticsChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);
  const [projDays, setProjDays] = useState<30 | 90 | 365>(30);

  const chartData = generatePersonGrowthData(debts, payments, currentUserId, projDays);

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

    const gradBalance = ctx.createLinearGradient(0, 0, 0, 240);
    gradBalance.addColorStop(0, isDark ? 'rgba(56, 217, 217, 0.35)' : 'rgba(0, 67, 73, 0.25)');
    gradBalance.addColorStop(1, 'rgba(56, 217, 217, 0.0)');

    chartInstanceRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [
          {
            label: 'Net Balance (Historical)',
            data: chartData.historicalBalance,
            borderColor: isDark ? '#38d9d9' : '#004349',
            backgroundColor: gradBalance,
            fill: true,
            borderWidth: 2.5,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: isDark ? '#38d9d9' : '#004349',
            spanGaps: false,
          },
          {
            label: 'Net Balance (Projected)',
            data: chartData.projectedBalance,
            borderColor: isDark ? '#38d9d9' : '#004349',
            borderDash: [5, 4],
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 5,
            spanGaps: false,
          },
          {
            label: 'Total Repaid',
            data: chartData.cumulativeRepayments,
            borderColor: isDark ? '#34d399' : '#006a69',
            borderWidth: 2,
            fill: false,
            tension: 0.2,
            pointRadius: 0,
            pointHoverRadius: 4,
            spanGaps: true,
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
          legend: { display: false },
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
                return `${dsLabel}: ${formatCurrency(val, currency, { showDecimals: true })}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 11 } },
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

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [chartData, currency, projDays]);

  return (
    <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm flex flex-col h-[380px]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
            Ledger Growth &amp; Trajectory
          </h3>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
            Historical loan balance and projected compounding trajectory with {personName}
          </p>
        </div>

        <div className="flex bg-[var(--surface-container)] p-0.5 rounded-xl border border-[var(--outline-variant)]/20 self-start sm:self-auto">
          {([30, 90, 365] as const).map((days) => (
            <button
              key={days}
              onClick={() => setProjDays(days)}
              className={`px-3 py-1 text-xs font-mono font-bold rounded-lg transition-all ${
                projDays === days
                  ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-xs'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              {days === 365 ? '1Y' : `${days}D`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 relative w-full h-full min-h-[200px]">
        <canvas ref={canvasRef} />
      </div>

      <div className="flex flex-wrap items-center justify-between text-xs font-mono text-[var(--on-surface-variant)] mt-3 pt-2 border-t border-[var(--outline-variant)]/15 gap-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-1 bg-[var(--primary)] rounded-full" />
            <span>Net Balance</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-1 bg-[var(--secondary)] rounded-full" />
            <span>Repaid</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="inline-block w-4 border-b-2 border-dashed border-[var(--outline)]" />
          <span>Dashed = Compound Interest Projection</span>
        </div>
      </div>
    </div>
  );
}
