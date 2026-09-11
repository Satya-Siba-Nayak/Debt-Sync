'use client';

import React, { useState } from 'react';
import { formatCurrency } from '@/lib/utils/currency';

interface CashflowDataPoint {
  label: string;
  moneyIn: number;
  moneyOut: number;
}

interface CashflowChartProps {
  currency?: string;
  data1M?: CashflowDataPoint[];
  data3M?: CashflowDataPoint[];
  data1Y?: CashflowDataPoint[];
}

export function CashflowChart({
  currency = 'inr',
  data1M,
  data3M,
  data1Y,
}: CashflowChartProps) {
  const [period, setPeriod] = useState<'1M' | '3M' | '1Y'>('3M');

  // Default fallback mock data representing recent months
  const default1M: CashflowDataPoint[] = [
    { label: 'W1', moneyIn: 1200, moneyOut: 2000 },
    { label: 'W2', moneyIn: 1800, moneyOut: 1500 },
    { label: 'W3', moneyIn: 3200, moneyOut: 1000 },
    { label: 'W4', moneyIn: 2500, moneyOut: 3000 },
  ];

  const default3M: CashflowDataPoint[] = [
    { label: 'Apr', moneyIn: 4500, moneyOut: 6200 },
    { label: 'May', moneyIn: 8200, moneyOut: 5100 },
    { label: 'Jun', moneyIn: 6400, moneyOut: 7800 },
  ];

  const default1Y: CashflowDataPoint[] = [
    { label: 'Jan', moneyIn: 3000, moneyOut: 5000 },
    { label: 'Feb', moneyIn: 4200, moneyOut: 3800 },
    { label: 'Mar', moneyIn: 7800, moneyOut: 6100 },
    { label: 'Apr', moneyIn: 5100, moneyOut: 4200 },
    { label: 'May', moneyIn: 6500, moneyOut: 5900 },
    { label: 'Jun', moneyIn: 8900, moneyOut: 7100 },
  ];

  const activeData =
    period === '1M'
      ? data1M || default1M
      : period === '3M'
      ? data3M || default3M
      : data1Y || default1Y;

  const maxVal = Math.max(
    ...activeData.flatMap((d) => [d.moneyIn, d.moneyOut]),
    1000
  );

  return (
    <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 flex flex-col h-[380px] shadow-sm">
      {/* Header with Title & Period Buttons */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="font-heading text-lg md:text-xl font-bold text-[var(--on-surface)]">
            Cashflow Trend
          </h3>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
            Money In (Repayments) vs Money Out (Loans)
          </p>
        </div>

        <div className="flex bg-[var(--surface-container)] p-1 rounded-xl border border-[var(--outline-variant)]/20">
          {(['1M', '3M', '1Y'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-mono font-bold rounded-lg transition-all ${
                period === p
                  ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-sm'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Visual Graphic Area */}
      <div className="flex-1 relative w-full h-full flex items-end gap-3 pb-3 border-b border-l border-[var(--outline-variant)]/30 pl-3">
        {/* Background Subtle Grid Lines */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            background:
              'repeating-linear-gradient(0deg, transparent, transparent 39px, #6f797a 40px)',
          }}
        />

        {/* Dynamic Dual Bars & Tooltips */}
        {activeData.map((d, i) => {
          const inHeightPercent = Math.max(10, (d.moneyIn / maxVal) * 100);
          const outHeightPercent = Math.max(10, (d.moneyOut / maxVal) * 100);

          return (
            <div
              key={i}
              className="flex-1 h-full flex items-end justify-center gap-1.5 z-10 group relative"
            >
              {/* Money In Bar (Secondary Teal) */}
              <div
                className="w-1/2 bg-[var(--secondary)]/80 hover:bg-[var(--secondary)] rounded-t transition-all cursor-pointer"
                style={{ height: `${inHeightPercent}%` }}
              />

              {/* Money Out Bar (Primary Teal) */}
              <div
                className="w-1/2 bg-[var(--primary)]/90 hover:bg-[var(--primary)] rounded-t transition-all cursor-pointer"
                style={{ height: `${outHeightPercent}%` }}
              />

              {/* Hover Tooltip */}
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center bg-[var(--inverse-surface)] text-[var(--inverse-on-surface)] text-[11px] font-mono px-2 py-1 rounded shadow-lg whitespace-nowrap pointer-events-none z-20">
                <span>In: {formatCurrency(d.moneyIn, currency)}</span>
                <span>Out: {formatCurrency(d.moneyOut, currency)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* X-Axis Labels & Legend */}
      <div className="flex justify-between items-center text-xs font-mono text-[var(--on-surface-variant)] mt-3 px-2">
        <div className="flex gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-[var(--secondary)]" />
            <span>Money In</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-[var(--primary)]" />
            <span>Money Out</span>
          </div>
        </div>

        <div className="flex gap-4">
          {activeData.map((d, i) => (
            <span key={i} className="font-semibold">
              {d.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
