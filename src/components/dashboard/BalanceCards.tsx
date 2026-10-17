import React from 'react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils/currency';

interface BalanceCardsProps {
  netPosition: number;
  totalLent: number;
  totalOwed: number;
  activeLentCount: number;
  activeOwedCount: number;
  currency?: string;
  monthlyGrowth?: number;
  totalInterestAccrued?: number;
  borrowingInterestAccrued?: number;
}

export function BalanceCards({
  netPosition,
  totalLent,
  totalOwed,
  activeLentCount,
  activeOwedCount,
  currency = 'inr',
  monthlyGrowth = 0,
  totalInterestAccrued = 0,
  borrowingInterestAccrued = 0,
}: BalanceCardsProps) {
  const isNetPositive = netPosition >= 0;
  const totalExposure = totalLent + totalOwed;
  const lentSharePercent = totalExposure > 0 ? Math.round((totalLent / totalExposure) * 100) : 50;
  const owedSharePercent = totalExposure > 0 ? 100 - lentSharePercent : 50;

  return (
    <section className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6">
      {/* Featured Net Position Card */}
      <div className="md:col-span-2 glass-card rounded-2xl p-6 md:p-7 border border-[var(--outline-variant)]/30 flex flex-col justify-between relative overflow-hidden group shadow-sm hover:shadow-md transition-all">
        <div className="absolute right-[-20px] top-[-20px] w-40 h-40 bg-[var(--secondary-container)]/20 rounded-full blur-3xl group-hover:scale-125 transition-transform duration-700 pointer-events-none" />

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 text-[var(--on-surface-variant)]">
              <div className="w-8 h-8 rounded-xl bg-[var(--primary)]/12 text-[var(--primary)] flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">
                  account_balance
                </span>
              </div>
              <span className="font-mono text-xs uppercase tracking-wider font-semibold">
                Net Portfolio Position
              </span>
            </div>

            <span
              className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold uppercase tracking-wider border ${
                netPosition > 0
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                  : netPosition < 0
                  ? 'bg-red-500/10 text-[var(--error)] border-red-500/25'
                  : 'bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] border-[var(--outline-variant)]/30'
              }`}
            >
              {netPosition > 0 ? 'Net Creditor' : netPosition < 0 ? 'Net Borrower' : 'Balanced'}
            </span>
          </div>

          <div
            className={`font-heading text-3xl md:text-5xl font-bold tracking-tight mt-2 ${
              netPosition > 0
                ? 'text-[var(--primary)] dark:text-[var(--primary-fixed-dim)]'
                : netPosition < 0
                ? 'text-[var(--error)]'
                : 'text-[var(--on-surface)]'
            }`}
          >
            {netPosition > 0 ? '+' : ''}
            {formatCurrency(netPosition, currency)}
          </div>

          {/* Visual Portfolio Allocation Bar */}
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-[var(--on-surface-variant)]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--secondary)] inline-block" />
                <span>Receivable ({totalExposure > 0 ? `${lentSharePercent}%` : '0%'})</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span>Payable ({totalExposure > 0 ? `${owedSharePercent}%` : '0%'})</span>
                <span className="w-2 h-2 rounded-full bg-[var(--error)] inline-block" />
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-[var(--surface-container-high)] overflow-hidden flex">
              {totalExposure > 0 ? (
                <>
                  <div
                    className="h-full bg-[var(--secondary)] transition-all duration-500"
                    style={{ width: `${lentSharePercent}%` }}
                  />
                  <div
                    className="h-full bg-[var(--error)]/80 transition-all duration-500"
                    style={{ width: `${owedSharePercent}%` }}
                  />
                </>
              ) : (
                <div className="h-full w-full bg-[var(--outline-variant)]/30" />
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between flex-wrap gap-2 border-t border-[var(--outline-variant)]/20 pt-3.5">
          <div className="font-mono text-xs flex items-center gap-1 font-semibold">
            {monthlyGrowth > 0 ? (
              <span className="text-[var(--secondary)] flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px]">trending_up</span>
                <span>+{formatCurrency(monthlyGrowth, currency)} / 30d yield</span>
              </span>
            ) : monthlyGrowth < 0 ? (
              <span className="text-[var(--error)] flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px]">trending_down</span>
                <span>{formatCurrency(monthlyGrowth, currency)} / 30d cost</span>
              </span>
            ) : (
              <span className="text-[var(--on-surface-variant)] flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px]">verified</span>
                <span>0% Interest Drift</span>
              </span>
            )}
          </div>
          <Link
            href="/analytics"
            className="text-[11px] font-mono font-bold text-[var(--primary)] hover:underline flex items-center gap-0.5"
          >
            <span>{activeLentCount + activeOwedCount} Active Ledgers</span>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          </Link>
        </div>
      </div>

      {/* Total Lent (Receivable) Card */}
      <Link
        href="/transactions?filter=lent"
        className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 border border-[var(--outline-variant)]/30 hover:border-[var(--secondary)]/40 flex flex-col justify-between shadow-sm hover:shadow-md transition-all group cursor-pointer"
      >
        <div>
          <div className="flex items-center justify-between text-[var(--on-surface-variant)] mb-3">
            <span className="font-mono text-xs uppercase tracking-wider font-semibold group-hover:text-[var(--on-surface)] transition-colors">
              Total Lent
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/12 text-[var(--secondary)] flex items-center justify-center group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[18px]">
                call_made
              </span>
            </div>
          </div>
          <div className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)]">
            {formatCurrency(totalLent, currency)}
          </div>
          {totalInterestAccrued > 0 && (
            <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-[var(--secondary)] font-mono text-[11px] font-semibold">
              <span className="material-symbols-outlined text-[12px]">add_chart</span>
              <span>+{formatCurrency(totalInterestAccrued, currency, { showDecimals: true })} interest</span>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-[var(--outline-variant)]/20 mt-5 flex items-center justify-between">
          <span className="font-mono text-xs text-[var(--on-surface-variant)]">
            {activeLentCount === 0
              ? 'No active receivables'
              : `${activeLentCount} active ${activeLentCount === 1 ? 'receivable' : 'receivables'}`}
          </span>
          <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)] group-hover:text-[var(--secondary)] group-hover:translate-x-0.5 transition-all">
            arrow_forward
          </span>
        </div>
      </Link>

      {/* Total Owed (Payable) Card */}
      <Link
        href="/transactions?filter=borrowed"
        className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 border border-[var(--outline-variant)]/30 hover:border-[var(--error)]/40 flex flex-col justify-between shadow-sm hover:shadow-md transition-all group cursor-pointer"
      >
        <div>
          <div className="flex items-center justify-between text-[var(--on-surface-variant)] mb-3">
            <span className="font-mono text-xs uppercase tracking-wider font-semibold group-hover:text-[var(--on-surface)] transition-colors">
              Total Owed
            </span>
            <div className="w-8 h-8 rounded-xl bg-red-500/12 text-[var(--error)] flex items-center justify-center group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[18px]">
                call_received
              </span>
            </div>
          </div>
          <div className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)]">
            {formatCurrency(totalOwed, currency)}
          </div>
          {borrowingInterestAccrued > 0 && (
            <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 text-[var(--error)] font-mono text-[11px] font-semibold">
              <span className="material-symbols-outlined text-[12px]">trending_up</span>
              <span>+{formatCurrency(borrowingInterestAccrued, currency, { showDecimals: true })} interest</span>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-[var(--outline-variant)]/20 mt-5 flex items-center justify-between">
          <span className="font-mono text-xs text-[var(--on-surface-variant)]">
            {activeOwedCount === 0
              ? 'All obligations clear'
              : `${activeOwedCount} active ${activeOwedCount === 1 ? 'payable' : 'payables'}`}
          </span>
          <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)] group-hover:text-[var(--error)] group-hover:translate-x-0.5 transition-all">
            arrow_forward
          </span>
        </div>
      </Link>
    </section>
  );
}
