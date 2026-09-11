'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { Chip } from '@/components/ui/Chip';
import { Avatar } from '@/components/ui/Avatar';
import { claimUserProfile } from '@/lib/utils/claim-profile';
import { getDueDateInfo } from '@/lib/utils/due-date';
import Link from 'next/link';

export default function TransactionsPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currency, setCurrency] = useState('inr');
  const [filter, setFilter] = useState<'all' | 'lent' | 'borrowed' | 'settled'>('all');

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      await claimUserProfile(user);

      const { data: settings } = await supabase
        .from('user_settings')
        .select('default_currency')
        .eq('user_id', user.id)
        .single();
      if (settings?.default_currency) setCurrency(settings.default_currency);

      const { data: debtRows } = await supabase
        .from('debts')
        .select(`
          *,
          lender:profiles!debts_lender_id_fkey(id, email, full_name, avatar_url),
          borrower:profiles!debts_borrower_id_fkey(id, email, full_name, avatar_url)
        `)
        .or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      const { data: paymentRows } = await supabase.from('payments').select('*');

      setDebts((debtRows as any) || []);
      setPayments((paymentRows as any) || []);
    } catch (err) {
      console.error('Error fetching transactions:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const handleAcceptDebt = async (debtId: string, decision: 'active' | 'declined') => {
    try {
      let success = false;
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('accept_debt', {
          p_debt_id: debtId,
          p_decision: decision,
        });
        if (!rpcErr && rpcRes && rpcRes.success) success = true;
      } catch (_) {}

      if (!success) {
        const { error: updateErr } = await supabase
          .from('debts')
          .update({
            status: decision,
            accepted_at: decision === 'active' ? new Date().toISOString() : null,
          })
          .eq('id', debtId);
        if (updateErr) throw updateErr;
      }

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      fetchTransactions();
    } catch (err: any) {
      console.error('Error updating debt:', err);
      alert(err.message || 'Failed to update debt agreement');
    }
  };

  useEffect(() => {
    fetchTransactions();

    const handleRefresh = () => fetchTransactions();
    window.addEventListener('debtsync:refresh', handleRefresh);

    const channel = supabase
      .channel('transactions-realtime-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'debts' }, () => {
        fetchTransactions();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchTransactions();
      })
      .subscribe();

    return () => {
      window.removeEventListener('debtsync:refresh', handleRefresh);
      supabase.removeChannel(channel);
    };
  }, [fetchTransactions, supabase]);

  const filteredDebts = debts.filter((d) => {
    const isLender = d.lender_id === currentUserId;
    if (filter === 'lent') return isLender;
    if (filter === 'borrowed') return !isLender;
    if (filter === 'settled') return d.status === 'settled';
    return true;
  });

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)]">
            Transactions History
          </h1>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-1">
            Complete audit trail of all peer-to-peer loans, micro-debts, and repayments
          </p>
        </div>

        <div className="flex bg-[var(--surface-container)] p-1 rounded-xl border border-[var(--outline-variant)]/20 self-start">
          {(['all', 'lent', 'borrowed', 'settled'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3.5 py-1.5 font-mono text-xs font-bold rounded-lg uppercase tracking-wider transition-all ${
                filter === tab
                  ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-sm'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 border border-[var(--outline-variant)]/30 shadow-sm overflow-x-auto">
        {loading ? (
          <div className="py-12 text-center font-mono text-xs text-[var(--on-surface-variant)]">
            Loading transaction history...
          </div>
        ) : filteredDebts.length === 0 ? (
          <div className="py-12 text-center font-mono text-xs text-[var(--on-surface-variant)]">
            No transactions found for this filter.
          </div>
        ) : (
          <div>
            {/* Mobile Card List (< md screens) */}
            <div className="md:hidden space-y-3">
              {filteredDebts.map((d) => {
                const isLender = d.lender_id === currentUserId;
                const otherPerson = isLender ? d.borrower : d.lender;
                const name = otherPerson?.full_name || otherPerson?.email || 'Unknown';
                const debtPayments = payments.filter((p) => p.debt_id === d.id);
                const calc = calculateDebtBalance(d, debtPayments);
                const dueDateInfo = getDueDateInfo(d.due_date, d.status);

                return (
                  <Link
                    key={d.id}
                    href={`/directory/detail?id=${otherPerson?.id || d.id}`}
                    className="block p-4 rounded-xl bg-[var(--surface-container-low)]/70 hover:bg-[var(--surface-container-high)]/70 border border-[var(--outline-variant)]/20 transition-all shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar
                          src={otherPerson?.avatar_url}
                          name={name}
                          size="md"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-[var(--on-surface)] truncate">
                            {name}
                          </p>
                          <p className="font-mono text-xs text-[var(--on-surface-variant)] truncate">
                            {new Date(d.created_at).toLocaleDateString()} • {otherPerson?.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
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
                        {dueDateInfo && (
                          <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-semibold border ${dueDateInfo.className} flex items-center gap-1`}>
                            <span className="material-symbols-outlined text-[11px]">
                              {dueDateInfo.isOverdue ? 'warning' : 'event'}
                            </span>
                            {dueDateInfo.text}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-[var(--outline-variant)]/15 flex items-center justify-between">
                      <div>
                        <span
                          className={`font-mono text-xs font-bold inline-flex items-center gap-1 ${
                            isLender ? 'text-[var(--secondary)]' : 'text-[var(--error)]'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {isLender ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                          {isLender ? 'You Lent' : 'You Borrowed'}
                        </span>
                        <div className="font-mono text-[11px] text-[var(--on-surface-variant)] mt-0.5">
                          Principal: {formatCurrency(d.principal, d.currency || currency)} • {d.interest_type === 'none' ? '0%' : `${d.interest_rate}% ${d.interest_type}`}
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-mono text-xs text-[var(--on-surface-variant)] block">
                          Remaining
                        </span>
                        <span className="font-mono font-bold text-base text-[var(--on-surface)]">
                          {formatCurrency(calc.currentBalance, d.currency || currency, { showDecimals: true })}
                        </span>
                      </div>
                    </div>

                    {d.status === 'pending' && d.created_by !== currentUserId && (
                      <div className="mt-3 pt-3 border-t border-amber-500/20 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono text-amber-500 font-medium">Awaiting your approval</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleAcceptDebt(d.id, 'active');
                            }}
                            className="px-3 py-1 bg-[var(--primary)] text-[var(--on-primary)] rounded-lg font-mono text-xs font-bold hover:opacity-90 shadow-sm"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (confirm('Decline this agreement?')) handleAcceptDebt(d.id, 'declined');
                            }}
                            className="px-2.5 py-1 border border-[var(--error)]/30 text-[var(--error)] rounded-lg font-mono text-xs font-bold hover:bg-[var(--error)]/10"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>

            {/* Desktop Table (>= md screens) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left font-body-md text-sm">
                <thead>
                  <tr className="border-b border-[var(--outline-variant)]/20 text-xs font-mono text-[var(--on-surface-variant)] uppercase tracking-wider">
                    <th className="pb-3 font-semibold">Date</th>
                    <th className="pb-3 font-semibold">Counterparty</th>
                    <th className="pb-3 font-semibold">Type</th>
                    <th className="pb-3 font-semibold">Principal</th>
                    <th className="pb-3 font-semibold">Interest Rate</th>
                    <th className="pb-3 font-semibold">Remaining</th>
                    <th className="pb-3 font-semibold">Status</th>
                    <th className="pb-3 font-semibold text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--outline-variant)]/10">
                  {filteredDebts.map((d) => {
                    const isLender = d.lender_id === currentUserId;
                    const otherPerson = isLender ? d.borrower : d.lender;
                    const name = otherPerson?.full_name || otherPerson?.email || 'Unknown';
                    const debtPayments = payments.filter((p) => p.debt_id === d.id);
                    const calc = calculateDebtBalance(d, debtPayments);
                    const dueDateInfo = getDueDateInfo(d.due_date, d.status);

                    return (
                      <tr key={d.id} className="hover:bg-[var(--surface-container-low)]/50 transition-colors">
                        <td className="py-4 font-mono text-xs text-[var(--on-surface-variant)]">
                          {new Date(d.created_at).toLocaleDateString()}
                        </td>

                        <td className="py-4">
                          <div className="flex items-center gap-3">
                            <Avatar
                              src={otherPerson?.avatar_url}
                              name={name}
                              size="sm"
                            />
                            <div>
                              <div className="font-semibold text-[var(--on-surface)]">{name}</div>
                              <div className="font-mono text-xs text-[var(--on-surface-variant)]">
                                {otherPerson?.email}
                              </div>
                            </div>
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

                        <td className="py-4 font-mono font-medium text-xs text-[var(--on-surface)]">
                          {formatCurrency(d.principal, d.currency || currency)}
                        </td>

                        <td className="py-4 font-mono text-xs text-[var(--on-surface-variant)]">
                          {d.interest_type === 'none' ? '0%' : `${d.interest_rate}% ${d.interest_type}`}
                        </td>

                        <td className="py-4 font-mono font-bold text-sm text-[var(--on-surface)]">
                          {formatCurrency(calc.currentBalance, d.currency || currency, { showDecimals: true })}
                        </td>

                        <td className="py-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
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
                            {dueDateInfo && (
                              <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-semibold border ${dueDateInfo.className} flex items-center gap-1`}>
                                <span className="material-symbols-outlined text-[11px]">
                                  {dueDateInfo.isOverdue ? 'warning' : 'event'}
                                </span>
                                {dueDateInfo.text}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-4 text-right">
                          {d.status === 'pending' && d.created_by !== currentUserId ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleAcceptDebt(d.id, 'active')}
                                className="px-2.5 py-1 bg-[var(--primary)] text-[var(--on-primary)] rounded-md font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-xs"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm('Decline this agreement?')) handleAcceptDebt(d.id, 'declined');
                                }}
                                className="px-2 py-1 border border-[var(--error)]/30 text-[var(--error)] rounded-md font-mono text-xs font-bold hover:bg-[var(--error)]/10"
                              >
                                Decline
                              </button>
                            </div>
                          ) : (
                            <Link
                              href={`/directory/detail?id=${otherPerson?.id || d.id}`}
                              className="font-mono text-xs text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] font-bold hover:underline"
                            >
                              Ledger
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
