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
  // Financial rule: Sub-cent fractional interest (< 0.01) is strictly 0 in base ledger calculation
  const sanitizedBase = totalInterestAccrued < 0.01 ? 0 : totalInterestAccrued;
  const wholeRef = useRef<HTMLSpanElement | null>(null);
  const fracRef = useRef<HTMLSpanElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const initialBaseRef = useRef<number>(sanitizedBase);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const base = totalInterestAccrued < 0.01 ? 0 : totalInterestAccrued;
    initialBaseRef.current = base;
    startTimeRef.current = Date.now();

    const whole = Math.floor(base);
    const frac = (base - whole).toFixed(4).substring(2);

    if (wholeRef.current) {
      wholeRef.current.textContent = whole.toLocaleString(currency === 'inr' ? 'en-IN' : 'en-US');
    }
    if (fracRef.current) {
      fracRef.current.textContent = frac;
    }
  }, [totalInterestAccrued, currency]);

  // High-performance continuous micro-accrual ticker without triggering React re-renders
  useEffect(() => {
    if (dailyRate <= 0) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const ratePerMs = dailyRate / 86400000;
    let lastRenderMs = 0;

    const tick = () => {
      const now = Date.now();
      // Throttle DOM text updates to ~15-20fps max for optimal CPU/battery efficiency
      if (now - lastRenderMs >= 50) {
        lastRenderMs = now;
        const elapsedMs = now - startTimeRef.current;
        const currentVal = initialBaseRef.current + ratePerMs * elapsedMs;
        const whole = Math.floor(currentVal);
        const frac = (currentVal - whole).toFixed(4).substring(2);

        if (wholeRef.current) {
          wholeRef.current.textContent = whole.toLocaleString(currency === 'inr' ? 'en-IN' : 'en-US');
        }
        if (fracRef.current) {
          fracRef.current.textContent = frac;
        }
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [dailyRate, currency]);

  const initialWhole = Math.floor(sanitizedBase).toLocaleString(currency === 'inr' ? 'en-IN' : 'en-US');
  const initialFrac = (sanitizedBase - Math.floor(sanitizedBase)).toFixed(4).substring(2);
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
      <div className="flex items-center justify-between w-full z-10 gap-2 min-w-0">
        <div className="flex items-center gap-1.5 text-[var(--on-primary-container)] min-w-0">
          <span className="material-symbols-outlined text-[18px] shrink-0">timelapse</span>
          <span className="font-mono text-xs uppercase tracking-wider font-semibold truncate">
            Interest Engine
          </span>
        </div>

        {dailyRate > 0 ? (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 font-bold uppercase tracking-wider flex items-center gap-1 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            Compounding
          </span>
        ) : (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-[var(--on-primary-container)] font-semibold shrink-0">
            Static
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
          <span ref={wholeRef} className="tabular-nums">
            {initialWhole}
          </span>
          <span className="text-2xl text-[var(--on-primary-container)]/80">.</span>
          <span ref={fracRef} className="text-2xl text-[var(--on-primary-container)]/80 font-semibold tabular-nums w-[48px] text-left">
            {initialFrac}
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
              All active loans are currently interest-free or settled.
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
