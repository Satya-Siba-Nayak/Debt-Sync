'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { Chip } from '@/components/ui/Chip';
import { Avatar } from '@/components/ui/Avatar';
import { CounterpartyNoteModal } from '@/components/debts/CounterpartyNoteModal';
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
  const [filter, setFilter] = useState<'all' | 'lent' | 'borrowed' | 'settled' | 'declined'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDebtForNote, setSelectedDebtForNote] = useState<Debt | null>(null);

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

  const handleDismissDeclinedDebt = async (debtId: string, currentHidden: string[] = []) => {
    if (!currentUserId) return;
    try {
      const updatedHidden = Array.from(new Set([...currentHidden, currentUserId]));
      const { error } = await supabase
        .from('debts')
        .update({ hidden_by: updatedHidden })
        .eq('id', debtId);
      if (error) throw error;

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      fetchTransactions();
    } catch (err: any) {
      console.error('Failed to dismiss declined request:', err);
      alert('Could not dismiss request from view');
    }
  };

  const visibleDebts = debts.filter((d) => !d.hidden_by?.includes(currentUserId || ''));

  const filteredDebts = visibleDebts
    .filter((d) => {
      const isLender = d.lender_id === currentUserId;
      if (filter === 'lent') return isLender && d.status !== 'declined';
      if (filter === 'borrowed') return !isLender && d.status !== 'declined';
      if (filter === 'settled') return d.status === 'settled';
      if (filter === 'declined') return d.status === 'declined';
      return true;
    })
    .filter((d) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const isLender = d.lender_id === currentUserId;
      const otherPerson = isLender ? d.borrower : d.lender;
      const name = otherPerson?.full_name?.toLowerCase() || '';
      const email = otherPerson?.email?.toLowerCase() || '';
      const creatorNote = d.notes?.toLowerCase() || '';
      const counterpartyNote = d.counterparty_notes?.toLowerCase() || '';
      const principalStr = String(d.principal);

      return (
        name.includes(q) ||
        email.includes(q) ||
        creatorNote.includes(q) ||
        counterpartyNote.includes(q) ||
        principalStr.includes(q) ||
        d.status.toLowerCase().includes(q) ||
        d.interest_type.toLowerCase().includes(q)
      );
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

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Instant Search Bar */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-[16px] text-[var(--on-surface-variant)]">
              search
            </span>
            <input
              type="text"
              placeholder="Search notes, names, amounts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 pl-9 pr-3 py-1.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-xs text-[var(--on-surface)] font-mono outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div className="flex bg-[var(--surface-container)] p-1 rounded-xl border border-[var(--outline-variant)]/20 self-start flex-wrap gap-0.5">
            {(['all', 'lent', 'borrowed', 'settled', 'declined'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-3 py-1.5 font-mono text-xs font-bold rounded-lg uppercase tracking-wider transition-all ${
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
                    className={`block p-4 rounded-xl border transition-all shadow-xs ${
                      d.status === 'declined'
                        ? 'bg-[var(--surface-container-low)]/40 border-red-500/20 opacity-85'
                        : 'bg-[var(--surface-container-low)]/70 hover:bg-[var(--surface-container-high)]/70 border-[var(--outline-variant)]/20'
                    }`}
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
                              : d.status === 'declined'
                              ? 'declined'
                              : 'default'
                          }
                        />
                        {dueDateInfo && d.status !== 'declined' && (
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
                        {d.status === 'declined' ? (
                          <span className="font-mono text-xs font-bold inline-flex items-center gap-1 text-red-500 dark:text-red-400">
                            <span className="material-symbols-outlined text-[14px]">block</span>
                            Declined
                          </span>
                        ) : (
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
                        )}
                        <div className="font-mono text-[11px] text-[var(--on-surface-variant)] mt-0.5">
                          Principal: {d.status === 'declined' ? (
                            <span className="line-through">{formatCurrency(d.principal, d.currency || currency)}</span>
                          ) : (
                            formatCurrency(d.principal, d.currency || currency)
                          )} • {d.interest_type === 'none' ? '0%' : `${d.interest_rate}% ${d.interest_type}`}
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-mono text-xs text-[var(--on-surface-variant)] block">
                          Remaining
                        </span>
                        <span className="font-mono font-bold text-base text-[var(--on-surface)]">
                          {d.status === 'declined' ? (
                            <span className="text-red-500/80 dark:text-red-400/80 line-through text-xs font-mono">
                              Void
                            </span>
                          ) : (
                            formatCurrency(calc.currentBalance, d.currency || currency, { showDecimals: true })
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Notes preview */}
                    {(d.notes || d.counterparty_notes) && (
                      <div className="mt-2.5 pt-2 border-t border-[var(--outline-variant)]/10 text-xs space-y-1">
                        {d.notes && (
                          <div className="flex items-center gap-1.5 text-[var(--on-surface-variant)]">
                            <span className="material-symbols-outlined text-[14px] text-[var(--primary)]">edit_note</span>
                            <span className="truncate"><strong>Creator:</strong> {d.notes}</span>
                          </div>
                        )}
                        {d.counterparty_notes && (
                          <div className="flex items-center gap-1.5 text-[var(--on-surface-variant)]">
                            <span className="material-symbols-outlined text-[14px] text-[var(--secondary)]">quick_reference_all</span>
                            <span className="truncate"><strong>Counterparty:</strong> {d.counterparty_notes}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-3 pt-2.5 border-t border-[var(--outline-variant)]/15 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedDebtForNote(d);
                        }}
                        className="py-1 px-2.5 rounded-lg border border-[var(--outline-variant)]/30 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] font-mono text-xs flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {d.notes || d.counterparty_notes ? 'note' : 'add_comment'}
                        </span>
                        <span>{d.notes || d.counterparty_notes ? 'Notes' : '+ Note'}</span>
                      </button>

                      {d.status === 'declined' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDismissDeclinedDebt(d.id, d.hidden_by || []);
                          }}
                          className="py-1 px-2.5 rounded-lg border border-[var(--outline-variant)]/30 text-[var(--on-surface-variant)] hover:text-red-500 font-mono text-xs flex items-center gap-1"
                          title="Dismiss from your view"
                        >
                          <span className="material-symbols-outlined text-[14px]">visibility_off</span>
                          <span>Dismiss</span>
                        </button>
                      )}
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
                      <tr
                        key={d.id}
                        className={`transition-colors ${
                          d.status === 'declined'
                            ? 'bg-red-500/5 hover:bg-red-500/10 opacity-80'
                            : 'hover:bg-[var(--surface-container-low)]/50'
                        }`}
                      >
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
                              {(d.notes || d.counterparty_notes) && (
                                <div className="mt-1 space-y-0.5 max-w-xs">
                                  {d.notes && (
                                    <div className="text-[11px] text-[var(--on-surface-variant)] truncate flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[12px] text-[var(--primary)] shrink-0">edit_note</span>
                                      <span className="truncate italic">"{d.notes}"</span>
                                    </div>
                                  )}
                                  {d.counterparty_notes && (
                                    <div className="text-[11px] text-[var(--on-surface-variant)] truncate flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[12px] text-[var(--secondary)] shrink-0">quick_reference_all</span>
                                      <span className="truncate italic">"{d.counterparty_notes}"</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-4">
                          {d.status === 'declined' ? (
                            <span className="font-mono text-xs font-bold inline-flex items-center gap-1 text-red-500 dark:text-red-400">
                              <span className="material-symbols-outlined text-[14px]">block</span>
                              Declined
                            </span>
                          ) : (
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
                          )}
                        </td>

                        <td className="py-4 font-mono font-medium text-xs text-[var(--on-surface)]">
                          {d.status === 'declined' ? (
                            <span className="line-through text-on-surface-variant">
                              {formatCurrency(d.principal, d.currency || currency)}
                            </span>
                          ) : (
                            formatCurrency(d.principal, d.currency || currency)
                          )}
                        </td>

                        <td className="py-4 font-mono text-xs text-[var(--on-surface-variant)]">
                          {d.interest_type === 'none' ? '0%' : `${d.interest_rate}% ${d.interest_type}`}
                        </td>

                        <td className="py-4 font-mono font-bold text-sm text-[var(--on-surface)]">
                          {d.status === 'declined' ? (
                            <span className="text-red-500/80 dark:text-red-400/80 line-through text-xs font-mono">
                              Void
                            </span>
                          ) : (
                            formatCurrency(calc.currentBalance, d.currency || currency, { showDecimals: true })
                          )}
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
                                  : d.status === 'declined'
                                  ? 'declined'
                                  : 'default'
                              }
                            />
                            {dueDateInfo && d.status !== 'declined' && (
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
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Two-sided Note Button */}
                            <button
                              type="button"
                              onClick={() => setSelectedDebtForNote(d)}
                              className="p-1.5 rounded-lg border border-[var(--outline-variant)]/30 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container)] transition-colors"
                              title="View or edit 2-sided notes"
                            >
                              <span className="material-symbols-outlined text-[15px]">
                                {d.notes || d.counterparty_notes ? 'note' : 'add_comment'}
                              </span>
                            </button>

                            {/* Dismiss button for declined requests */}
                            {d.status === 'declined' && (
                              <button
                                type="button"
                                onClick={() => handleDismissDeclinedDebt(d.id, d.hidden_by || [])}
                                className="p-1.5 rounded-lg border border-[var(--outline-variant)]/30 text-[var(--on-surface-variant)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                title="Dismiss from your view (persists in activity log audit trail)"
                              >
                                <span className="material-symbols-outlined text-[15px]">visibility_off</span>
                              </button>
                            )}

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
                                className="font-mono text-xs text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] font-bold hover:underline ml-1"
                              >
                                Ledger
                              </Link>
                            )}
                          </div>
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

      {/* Counterparty Note Modal */}
      {selectedDebtForNote && (
        <CounterpartyNoteModal
          isOpen={Boolean(selectedDebtForNote)}
          debt={selectedDebtForNote}
          currentUserId={currentUserId || ''}
          onClose={() => setSelectedDebtForNote(null)}
          onNoteUpdated={fetchTransactions}
        />
      )}
    </div>
  );
}
