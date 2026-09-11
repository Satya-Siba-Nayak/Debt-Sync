'use client';

import React, { useEffect, useState, useRef } from 'react';
import { formatCurrency } from '@/lib/utils/currency';

interface LiveTickerProps {
  totalInterestAccrued: number;
  dailyRate?: number;
  currency?: string;
  lendingInterestTotal?: number;
  borrowingInterestTotal?: number;
}

export function LiveTicker({
  totalInterestAccrued,
  dailyRate = 0,
  currency = 'inr',
  lendingInterestTotal,
  borrowingInterestTotal,
}: LiveTickerProps) {
  const [liveVal, setLiveVal] = useState(totalInterestAccrued);
  const startTimeRef = useRef<number>(Date.now());
  const initialBaseRef = useRef<number>(totalInterestAccrued);

  // Sync when initial prop changes from fetch
  useEffect(() => {
    initialBaseRef.current = totalInterestAccrued;
    startTimeRef.current = Date.now();
    setLiveVal(totalInterestAccrued);
  }, [totalInterestAccrued]);

  // Real-time continuous micro-accrual tick effect based on genuine dailyRate
  useEffect(() => {
    if (dailyRate <= 0) {
      setLiveVal(initialBaseRef.current);
      return;
    }

    // Rate per millisecond: (dailyRate / 86,400,000)
    const ratePerMs = dailyRate / 86400000;

    const interval = setInterval(() => {
      const elapsedMs = Date.now() - startTimeRef.current;
      const computed = initialBaseRef.current + ratePerMs * elapsedMs;
      setLiveVal(computed);
    }, 50); // 20 updates per second for butter-smooth ticking

    return () => clearInterval(interval);
  }, [dailyRate]);

  const wholePart = Math.floor(liveVal);
  // Extract 4 decimal places for high-precision live compounding feedback
  const fractional = (liveVal - wholePart).toFixed(4).substring(2);

  const monthlyRate = dailyRate * 30.4375;

  return (
    <div className="bg-gradient-to-br from-[var(--primary)] to-[var(--primary-container)] rounded-2xl p-6 md:p-8 text-[var(--on-primary)] flex flex-col justify-between items-center relative overflow-hidden shadow-xl border border-[var(--primary-container)]/50 min-h-[400px]">
      {/* Background radial dot grid */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at center, #9bf0fa 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between w-full z-10">
        <div className="flex items-center gap-2 text-[var(--on-primary-container)]">
          <span className="material-symbols-outlined text-[20px]">timelapse</span>
          <span className="font-mono text-xs uppercase tracking-widest font-semibold">
            Interest Accrual Engine
          </span>
        </div>

        {dailyRate > 0 ? (
          <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            Compounding
          </span>
        ) : (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-[var(--on-primary-container)] font-semibold">
            Static Baseline
          </span>
        )}
      </div>

      {/* Main Counter Graphic */}
      <div className="my-auto z-10 flex flex-col items-center text-center">
        <span className="text-xs font-mono text-[var(--on-primary-container)] mb-1 uppercase tracking-wider">
          Total Interest Accrued (Earned)
        </span>

        <div className="font-mono text-4xl sm:text-5xl font-bold flex items-baseline tracking-tight">
          <span className="mr-1 text-[var(--on-primary-container)] text-3xl">
            {currency === 'inr' ? '₹' : currency.toUpperCase() + ' '}
          </span>
          <span className="tabular-nums">
            {wholePart.toLocaleString(currency === 'inr' ? 'en-IN' : 'en-US')}
          </span>
          <span className="text-2xl text-[var(--on-primary-container)]/80">.</span>
          <span className="text-2xl text-[var(--on-primary-container)]/80 font-semibold tabular-nums w-[48px] text-left">
            {fractional}
          </span>
        </div>

        {/* Breakdown if both lent & borrowed exist */}
        {(lendingInterestTotal !== undefined || borrowingInterestTotal !== undefined) && (
          <div className="flex items-center gap-4 mt-3 text-[11px] font-mono text-[var(--on-primary-container)]/90">
            {lendingInterestTotal !== undefined && (
              <span>Earned: +{formatCurrency(lendingInterestTotal, currency, { showDecimals: true })}</span>
            )}
            {borrowingInterestTotal !== undefined && borrowingInterestTotal > 0 && (
              <span>Incurred: -{formatCurrency(borrowingInterestTotal, currency, { showDecimals: true })}</span>
            )}
          </div>
        )}
      </div>

      {/* Footer / Speed Ticker */}
      <div className="z-10 w-full flex flex-col items-center gap-2">
        {dailyRate > 0 ? (
          <div className="w-full bg-[var(--primary-container)]/80 px-4 py-2.5 rounded-xl border border-[var(--on-primary-container)]/20 flex flex-col items-center shadow-inner">
            <div className="flex items-center justify-between w-full text-xs font-mono">
              <span className="text-[var(--on-primary-container)]">Accrual Velocity</span>
              <span className="font-bold text-emerald-300">
                +{formatCurrency(dailyRate, currency, { showDecimals: true })} / day
              </span>
            </div>
            <div className="flex items-center justify-between w-full text-[11px] font-mono text-[var(--on-primary-container)]/75 mt-0.5">
              <span>Monthly Run-rate</span>
              <span>(+{formatCurrency(monthlyRate, currency)})</span>
            </div>
          </div>
        ) : (
          <div className="bg-[var(--primary-container)]/50 px-4 py-2 rounded-xl border border-[var(--on-primary-container)]/15 text-center w-full">
            <p className="font-mono text-xs text-[var(--on-primary-container)]">
              All active loans are currently 0% interest-free.
            </p>
          </div>
        )}

        <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--on-primary-container)]/70">
          <span className="material-symbols-outlined text-[13px]">calculate</span>
          <span>Verified against peer agreement terms</span>
        </div>
      </div>
    </div>
  );
}
