'use client';

import React, { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/utils/currency';

interface LiveTickerProps {
  totalInterestAccrued: number;
  dailyRate?: number;
  currency?: string;
}

export function LiveTicker({
  totalInterestAccrued,
  dailyRate = 0,
  currency = 'inr',
}: LiveTickerProps) {
  const [currentVal, setCurrentVal] = useState(totalInterestAccrued);

  useEffect(() => {
    setCurrentVal(totalInterestAccrued);
  }, [totalInterestAccrued]);

  // Live micro-accrual tick effect
  useEffect(() => {
    // If daily rate is > 0, tick every 2 seconds by micro amounts
    const tickInterval = setInterval(() => {
      const microIncrement = dailyRate > 0 ? (dailyRate / (24 * 60 * 30)) : (Math.random() * 0.03 + 0.01);
      setCurrentVal((prev) => prev + microIncrement);
    }, 2000);

    return () => clearInterval(tickInterval);
  }, [dailyRate]);

  const wholePart = Math.floor(currentVal);
  const decimalPart = Math.floor((currentVal - wholePart) * 100)
    .toString()
    .padStart(2, '0');

  return (
    <div className="bg-gradient-to-br from-[var(--primary)] to-[var(--primary-container)] rounded-2xl p-6 md:p-8 text-[var(--on-primary)] flex flex-col justify-between items-center relative overflow-hidden shadow-xl border border-[var(--primary-container)]/50 min-h-[320px]">
      {/* Background radial dot grid */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at center, #9bf0fa 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />

      <div className="flex items-center gap-2 text-[var(--on-primary-container)] mb-4 z-10">
        <span className="material-symbols-outlined text-[20px]">timelapse</span>
        <span className="font-mono text-xs uppercase tracking-widest font-semibold">
          Total Interest Accrued
        </span>
      </div>

      <div className="font-mono text-4xl md:text-5xl font-bold z-10 flex items-baseline tracking-tight my-auto">
        <span className="mr-1 text-[var(--on-primary-container)]">
          {currency === 'inr' ? '₹' : currency.toUpperCase() + ' '}
        </span>
        <span className="tabular-nums">
          {wholePart.toLocaleString(currency === 'inr' ? 'en-IN' : 'en-US')}
        </span>
        <span className="text-2xl ticker-decimals opacity-60">.</span>
        <span className="text-2xl ticker-decimals opacity-60 w-[36px] inline-block text-left tabular-nums">
          {decimalPart}
        </span>
      </div>

      <div className="z-10 mt-6 flex flex-col items-center gap-2">
        <div className="bg-[var(--primary-container)]/60 px-4 py-1.5 rounded-full border border-[var(--on-primary-container)]/20 flex items-center gap-2 shadow-inner">
          <div className="w-2 h-2 rounded-full bg-[var(--secondary-container)] animate-pulse" />
          <span className="font-mono text-xs text-[var(--on-primary-container)] font-medium">
            Live Sync Active
          </span>
        </div>

        {dailyRate > 0 && (
          <span className="text-[11px] font-mono text-[var(--on-primary-container)]/80">
            +{formatCurrency(dailyRate, currency, { showDecimals: true })} / day accrual speed
          </span>
        )}
      </div>
    </div>
  );
}
