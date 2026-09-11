import React from 'react';
import { formatCurrency } from '@/lib/utils/currency';

interface BalanceCardsProps {
  netPosition: number;
  totalLent: number;
  totalOwed: number;
  activeLentCount: number;
  activeOwedCount: number;
  currency?: string;
  monthlyGrowth?: number;
}

export function BalanceCards({
  netPosition,
  totalLent,
  totalOwed,
  activeLentCount,
  activeOwedCount,
  currency = 'inr',
  monthlyGrowth = 0,
}: BalanceCardsProps) {
  const isNetPositive = netPosition >= 0;

  return (
    <section className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6">
      {/* Featured Net Position Card */}
      <div className="md:col-span-2 glass-card rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 flex flex-col justify-between relative overflow-hidden group shadow-sm hover:shadow-md transition-shadow">
        <div className="absolute right-[-20px] top-[-20px] w-36 h-36 bg-[var(--secondary-container)]/20 rounded-full blur-3xl group-hover:scale-125 transition-transform duration-700 pointer-events-none" />

        <div>
          <div className="flex items-center gap-2 text-[var(--on-surface-variant)] mb-2">
            <span className="material-symbols-outlined text-[20px] text-[var(--primary)]">
              account_balance
            </span>
            <span className="font-mono text-xs uppercase tracking-wider font-semibold">
              Net Position
            </span>
          </div>

          <div
            className={`font-heading text-3xl md:text-5xl font-bold tracking-tight mt-3 ${
              isNetPositive ? 'text-[var(--primary)] dark:text-[var(--primary-fixed-dim)]' : 'text-[var(--error)]'
            }`}
          >
            {formatCurrency(netPosition, currency)}
          </div>
        </div>

        <div className="mt-8 flex items-end justify-between border-t border-[var(--outline-variant)]/20 pt-4">
          <div className="text-[var(--secondary)] font-mono text-xs flex items-center gap-1 font-semibold">
            <span className="material-symbols-outlined text-[16px]">trending_up</span>
            <span>
              {monthlyGrowth >= 0 ? '+' : ''}
              {formatCurrency(monthlyGrowth, currency)} this month
            </span>
          </div>
          <span className="text-[11px] font-mono text-[var(--on-surface-variant)]">
            {activeLentCount + activeOwedCount} Total Active Ledgers
          </span>
        </div>
      </div>

      {/* Total Lent Card */}
      <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 border border-[var(--outline-variant)]/30 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
        <div>
          <div className="flex items-center justify-between text-[var(--on-surface-variant)] mb-3">
            <span className="font-mono text-xs uppercase tracking-wider font-semibold">
              Total Lent
            </span>
            <span className="material-symbols-outlined text-[20px] text-[var(--secondary)]">
              arrow_upward
            </span>
          </div>
          <div className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)]">
            {formatCurrency(totalLent, currency)}
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--outline-variant)]/20 mt-6">
          <span className="font-mono text-xs text-[var(--on-surface-variant)]">
            Across {activeLentCount} active {activeLentCount === 1 ? 'loan' : 'loans'}
          </span>
        </div>
      </div>

      {/* Total Owed Card */}
      <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 border border-[var(--outline-variant)]/30 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
        <div>
          <div className="flex items-center justify-between text-[var(--on-surface-variant)] mb-3">
            <span className="font-mono text-xs uppercase tracking-wider font-semibold">
              Total Owed
            </span>
            <span className="material-symbols-outlined text-[20px] text-[var(--error)]">
              arrow_downward
            </span>
          </div>
          <div className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)]">
            {formatCurrency(totalOwed, currency)}
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--outline-variant)]/20 mt-6">
          <span className="font-mono text-xs text-[var(--on-surface-variant)]">
            Across {activeOwedCount} active {activeOwedCount === 1 ? 'loan' : 'loans'}
          </span>
        </div>
      </div>
    </section>
  );
}
