'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance, calculatePortfolioAccrualRates } from '@/lib/utils/interest';
import { BalanceCards } from '@/components/dashboard/BalanceCards';
import { LiveTicker } from '@/components/dashboard/LiveTicker';
import { CashflowChart } from '@/components/dashboard/CashflowChart';
import { formatCurrency } from '@/lib/utils/currency';
import { Chip } from '@/components/ui/Chip';
import Link from 'next/link';

export default function GlobalDashboardPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState('inr');
  const [debts, setDebts] = useState<Debt[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Portfolio Totals
  const [netPosition, setNetPosition] = useState(0);
  const [totalLent, setTotalLent] = useState(0);
  const [totalOwed, setTotalOwed] = useState(0);
  const [activeLentCount, setActiveLentCount] = useState(0);
  const [activeOwedCount, setActiveOwedCount] = useState(0);
  const [totalInterestAccrued, setTotalInterestAccrued] = useState(0);
  const [dailyAccrualRate, setDailyAccrualRate] = useState(0);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // Fetch user settings for default currency
      const { data: settings } = await supabase
        .from('user_settings')
        .select('default_currency')
        .eq('user_id', user.id)
        .single();
      if (settings?.default_currency) {
        setCurrency(settings.default_currency);
      }

      // Fetch all debts where current user is lender OR borrower
      const { data: debtRecords } = await supabase
        .from('debts')
        .select(`
          *,
          lender:profiles!debts_lender_id_fkey(id, email, full_name),
          borrower:profiles!debts_borrower_id_fkey(id, email, full_name)
        `)
        .or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      // Fetch all payments related to user's debts
      const { data: paymentRecords } = await supabase
        .from('payments')
        .select('*');

      const allDebts: Debt[] = (debtRecords as any) || [];
      const allPayments: Payment[] = (paymentRecords as any) || [];

      setDebts(allDebts);
      setPayments(allPayments);

      // Compute calculations
      let lentSum = 0;
      let owedSum = 0;
      let lentCount = 0;
      let owedCount = 0;
      let accruedInterestSum = 0;

      for (const d of allDebts) {
        if (d.status === 'settled' || d.status === 'declined') continue;

        const debtPayments = allPayments.filter((p) => p.debt_id === d.id);
        const calc = calculateDebtBalance(d, debtPayments);

        if (d.lender_id === user.id) {
          // User is lender: money owed TO user
          lentSum += calc.currentBalance;
          lentCount++;
          accruedInterestSum += calc.totalAccruedInterest;
        } else {
          // User is borrower: money user OWES
          owedSum += calc.currentBalance;
          owedCount++;
        }
      }

      setTotalLent(lentSum);
      setTotalOwed(owedSum);
      setNetPosition(lentSum - owedSum);
      setActiveLentCount(lentCount);
      setActiveOwedCount(owedCount);
      setTotalInterestAccrued(accruedInterestSum);

      const rates = calculatePortfolioAccrualRates(
        allDebts.filter((d) => d.lender_id === user.id)
      );
      setDailyAccrualRate(rates.dailyInterestGrowth);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchDashboardData();

    // Listen to custom refresh events triggered after debt creation
    const handleRefresh = () => fetchDashboardData();
    window.addEventListener('debtsync:refresh', handleRefresh);
    return () => window.removeEventListener('debtsync:refresh', handleRefresh);
  }, [fetchDashboardData]);

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      {/* 1. Top Bento Summary Grid */}
      <BalanceCards
        netPosition={netPosition}
        totalLent={totalLent}
        totalOwed={totalOwed}
        activeLentCount={activeLentCount}
        activeOwedCount={activeOwedCount}
        currency={currency}
        monthlyGrowth={dailyAccrualRate * 30}
      />

      {/* 2. Middle Row: Cashflow Trend Chart & Live Accrual Ticker */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <CashflowChart currency={currency} />
        </div>

        <div className="lg:col-span-1">
          <LiveTicker
            totalInterestAccrued={totalInterestAccrued}
            dailyRate={dailyAccrualRate}
            currency={currency}
          />
        </div>
      </section>

      {/* 3. Recent Activity & Active Ledgers Overview */}
      <section className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="font-heading text-lg md:text-xl font-bold text-[var(--on-surface)]">
              Active Transactions
            </h3>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
              Recent micro-loans and peer obligations
            </p>
          </div>

          <Link
            href="/directory"
            className="text-xs font-mono font-bold text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] hover:underline flex items-center gap-1"
          >
            <span>View All</span>
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          </Link>
        </div>

        {loading ? (
          <div className="py-12 text-center font-mono text-xs text-[var(--on-surface-variant)]">
            Loading ledger data...
          </div>
        ) : debts.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--surface-container)] flex items-center justify-center mx-auto mb-3 text-[var(--on-surface-variant)]">
              <span className="material-symbols-outlined text-2xl">receipt_long</span>
            </div>
            <p className="font-heading font-medium text-sm text-[var(--on-surface)]">
              No active debts recorded yet
            </p>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-1">
              Click &quot;New Transaction&quot; to log your first loan or borrowing
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-body-md text-sm">
              <thead>
                <tr className="border-b border-[var(--outline-variant)]/20 text-xs font-mono text-[var(--on-surface-variant)] uppercase tracking-wider">
                  <th className="pb-3 font-semibold">Counterparty</th>
                  <th className="pb-3 font-semibold">Role</th>
                  <th className="pb-3 font-semibold">Interest Terms</th>
                  <th className="pb-3 font-semibold">Balance</th>
                  <th className="pb-3 font-semibold">Status</th>
                  <th className="pb-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--outline-variant)]/10">
                {debts.slice(0, 6).map((d) => {
                  const isLender = d.lender_id === currentUserId;
                  const otherPerson = isLender ? d.borrower : d.lender;
                  const name = otherPerson?.full_name || otherPerson?.email || 'Unknown';
                  const debtPayments = payments.filter((p) => p.debt_id === d.id);
                  const calc = calculateDebtBalance(d, debtPayments);

                  return (
                    <tr key={d.id} className="hover:bg-[var(--surface-container-low)]/50 transition-colors">
                      <td className="py-4">
                        <div className="font-semibold text-[var(--on-surface)]">{name}</div>
                        <div className="font-mono text-xs text-[var(--on-surface-variant)]">
                          {otherPerson?.email}
                        </div>
                      </td>

                      <td className="py-4">
                        <span
                          className={`font-mono text-xs font-bold inline-flex items-center gap-1 ${
                            isLender ? 'text-[var(--secondary)]' : 'text-[var(--error)]'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {isLender ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                          {isLender ? 'Lent' : 'Borrowed'}
                        </span>
                      </td>

                      <td className="py-4 font-mono text-xs text-[var(--on-surface-variant)]">
                        {d.interest_type === 'none' ? (
                          <span>0% (Interest-Free)</span>
                        ) : (
                          <span>
                            {d.interest_rate}% {d.interest_type} ({d.compound_freq || 'yr'})
                          </span>
                        )}
                      </td>

                      <td className="py-4 font-mono font-bold text-sm text-[var(--on-surface)]">
                        {formatCurrency(calc.currentBalance, d.currency || currency, { showDecimals: true })}
                      </td>

                      <td className="py-4">
                        <Chip
                          label={d.status}
                          variant={
                            d.status === 'active'
                              ? 'active'
                              : d.status === 'settled'
                              ? 'settled'
                              : d.status === 'pending'
                              ? 'pending'
                              : 'default'
                          }
                        />
                      </td>

                      <td className="py-4 text-right">
                        <Link
                          href={`/directory/detail?id=${otherPerson?.id || d.id}`}
                          className="font-mono text-xs text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] font-bold hover:underline"
                        >
                          Details
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
