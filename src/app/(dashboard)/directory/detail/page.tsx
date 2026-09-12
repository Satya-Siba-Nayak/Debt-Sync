'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment, ActivityLogEntry, Profile } from '@/lib/types/database';
import { calculateDebtBalance, round2 } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { Chip } from '@/components/ui/Chip';
import { Avatar } from '@/components/ui/Avatar';
import { PaymentModal } from '@/components/debts/PaymentModal';
import { RecordDebtModal } from '@/components/debts/RecordDebtModal';
import { BulkPaymentModal } from '@/components/debts/BulkPaymentModal';
import { CounterpartyNoteModal } from '@/components/debts/CounterpartyNoteModal';
import { getDueDateInfo } from '@/lib/utils/due-date';
import { claimUserProfile } from '@/lib/utils/claim-profile';
import { PersonAnalyticsChart } from '@/components/directory/PersonAnalyticsChart';
import Link from 'next/link';

function PersonDebtDetailContent() {
  const searchParams = useSearchParams();
  const personId = searchParams.get('id') || '';

  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [person, setPerson] = useState<Profile | null>(null);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [currency, setCurrency] = useState('inr');

  // Search, Directional filter & Modals
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDirection, setFilterDirection] = useState<'all' | 'they_owe' | 'you_owe'>('all');
  const [activeDebtForPayment, setActiveDebtForPayment] = useState<{ debt: Debt; balance: number } | null>(null);
  const [selectedDebtForNote, setSelectedDebtForNote] = useState<Debt | null>(null);
  const [isRecordDebtOpen, setIsRecordDebtOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [verifyingPaymentId, setVerifyingPaymentId] = useState<string | null>(null);

  const fetchDetails = useCallback(async () => {
    if (!personId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // Claim any pending debts associated with user
      await claimUserProfile(user);

      // Currency setting
      const { data: settings } = await supabase
        .from('user_settings')
        .select('default_currency')
        .eq('user_id', user.id)
        .single();
      if (settings?.default_currency) setCurrency(settings.default_currency);

      // Fetch counterparty profile
      let resolvedPersonId = personId;
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', personId)
        .maybeSingle();

      let targetProfile = profile;

      if (!targetProfile) {
        // Fallback: check if personId is actually a debt ID
        const { data: debtRec } = await supabase
          .from('debts')
          .select(`
            id, lender_id, borrower_id,
            lender:profiles!debts_lender_id_fkey(*),
            borrower:profiles!debts_borrower_id_fkey(*)
          `)
          .eq('id', personId)
          .maybeSingle();

        if (debtRec) {
          const isLender = debtRec.lender_id === user.id;
          targetProfile = (isLender ? debtRec.borrower : debtRec.lender) as any;
          resolvedPersonId = targetProfile?.id || (isLender ? debtRec.borrower_id : debtRec.lender_id);
        }
      }

      setPerson(targetProfile);

      // Fetch all debts between user and this person
      const { data: debtRows } = await supabase
        .from('debts')
        .select('*')
        .or(
          `and(lender_id.eq.${user.id},borrower_id.eq.${resolvedPersonId}),and(lender_id.eq.${resolvedPersonId},borrower_id.eq.${user.id})`
        )
        .order('created_at', { ascending: false });

      const allDebts: Debt[] = debtRows || [];
      setDebts(allDebts);

      const debtIds = allDebts.map((d) => d.id);

      if (debtIds.length > 0) {
        // Fetch payments for these debts
        const { data: paymentRows } = await supabase
          .from('payments')
          .select('*')
          .in('debt_id', debtIds)
          .order('created_at', { ascending: false });
        setPayments(paymentRows || []);

        // Fetch activity logs for these debts
        const { data: logRows } = await supabase
          .from('activity_log')
          .select('*')
          .in('debt_id', debtIds)
          .order('created_at', { ascending: false });
        setActivityLogs(logRows || []);
      }
    } catch (err) {
      console.error('Error fetching debt details:', err);
    } finally {
      setLoading(false);
    }
  }, [personId, supabase]);

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
      fetchDetails();
    } catch (err: any) {
      console.error('Error updating debt:', err);
      alert(err.message || 'Failed to update debt agreement');
    }
  };

  const handleVerifyRepayment = async (paymentId: string, decision: 'verified' | 'disputed') => {
    setVerifyingPaymentId(paymentId);
    try {
      const rpcDecision = decision === 'verified' ? 'accepted' : 'declined';
      let handled = false;
      try {
        const { data, error } = await supabase.rpc('verify_repayment', {
          p_payment_id: paymentId,
          p_decision: rpcDecision,
        });
        if (!error && data?.success) handled = true;
      } catch (_) {}

      if (!handled) {
        if (decision === 'verified') {
          await supabase
            .from('payments')
            .update({
              is_verified: true,
              verified_at: new Date().toISOString(),
              verified_by: currentUserId,
            })
            .eq('id', paymentId);

          // Find the payment and check if the debt is now fully cleared
          const paymentItem = payments.find((p) => p.id === paymentId);
          if (paymentItem) {
            const targetDebt = debts.find((d) => d.id === paymentItem.debt_id);
            if (targetDebt) {
              const updatedPayments = payments.map((p) =>
                p.id === paymentId ? { ...p, is_verified: true } : p
              );
              const targetDebtPayments = updatedPayments.filter((p) => p.debt_id === targetDebt.id);
              const calc = calculateDebtBalance(targetDebt, targetDebtPayments);
              if (calc.currentBalance <= 0.01) {
                await supabase
                  .from('debts')
                  .update({
                    status: 'settled',
                    settled_at: new Date().toISOString(),
                  })
                  .eq('id', targetDebt.id);
              }
            }
          }
        } else {
          await supabase
            .from('payments')
            .update({
              is_verified: false,
              verified_at: new Date().toISOString(),
              verified_by: currentUserId,
            })
            .eq('id', paymentId);
        }
      }

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      await fetchDetails();
    } catch (err: any) {
      console.error('Error verifying repayment:', err);
      alert(err.message || 'Failed to process repayment verification');
    } finally {
      setVerifyingPaymentId(null);
    }
  };

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
      fetchDetails();
    } catch (err: any) {
      console.error('Failed to dismiss declined request:', err);
      alert('Could not dismiss request from view');
    }
  };

  useEffect(() => {
    fetchDetails();

    const handleRefresh = () => fetchDetails();
    window.addEventListener('debtsync:refresh', handleRefresh);

    const channel = supabase
      .channel(`person-detail-${personId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'debts' }, () => {
        fetchDetails();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchDetails();
      })
      .subscribe();

    return () => {
      window.removeEventListener('debtsync:refresh', handleRefresh);
      supabase.removeChannel(channel);
    };
  }, [fetchDetails, personId, supabase]);

  // Calculations across all debts with this person
  let totalOutstandingLent = 0;
  let totalOutstandingBorrowed = 0;
  let totalPrincipal = 0;
  let totalAccruedInterest = 0;

  for (const d of debts) {
    if (d.status === 'settled' || d.status === 'declined') continue;
    const debtPayments = payments.filter((p) => p.debt_id === d.id);
    const calc = calculateDebtBalance(d, debtPayments);

    totalPrincipal += calc.principal;
    totalAccruedInterest += calc.totalAccruedInterest;

    if (d.lender_id === currentUserId) {
      totalOutstandingLent += calc.currentBalance;
    } else {
      totalOutstandingBorrowed += calc.currentBalance;
    }
  }

  const netBalance = totalOutstandingLent - totalOutstandingBorrowed;
  const isNetPositive = netBalance > 0;

  // 3-way Financial Breakdown: Remaining Principal vs Accrued Interest vs Repaid
  const totalPaid = round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const totalOutstanding = Math.abs(netBalance) <= 0.005 ? 0 : round2(Math.abs(netBalance));
  const remainingPrincipal = Math.max(0, Math.min(round2(totalPrincipal), totalOutstanding));
  const accruedInterest = Math.max(0, round2(totalOutstanding - remainingPrincipal));
  const grandTotal = Math.max(1, totalOutstanding + totalPaid);

  const principalPct = Math.round((remainingPrincipal / grandTotal) * 100);
  const interestPct = Math.round((accruedInterest / grandTotal) * 100);
  const paidPct = Math.max(0, 100 - principalPct - interestPct);

  // Directional Filtering & Counts (Declined agreements are void and excluded from active debtor counts)
  // Exclude debts hidden by current user from UI (still persisted in activity_log for transparency)
  const visibleDebts = debts.filter((d) => !d.hidden_by?.includes(currentUserId || ''));

  const theyOweDebts = visibleDebts.filter((d) => d.lender_id === currentUserId && d.status !== 'declined');
  const youOweDebts = visibleDebts.filter((d) => d.borrower_id === currentUserId && d.status !== 'declined');

  const displayDebts = visibleDebts
    .filter((d) => {
      if (filterDirection === 'they_owe') return d.lender_id === currentUserId && d.status !== 'declined';
      if (filterDirection === 'you_owe') return d.borrower_id === currentUserId && d.status !== 'declined';
      return true;
    })
    .filter((d) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        (d.notes && d.notes.toLowerCase().includes(q)) ||
        (d.counterparty_notes && d.counterparty_notes.toLowerCase().includes(q)) ||
        String(d.principal).includes(q) ||
        (d.interest_type ? d.interest_type.toLowerCase().includes(q) : false) ||
        (d.status ? d.status.toLowerCase().includes(q) : false)
      );
    });

  let filteredBalance = 0;
  for (const d of displayDebts) {
    if (d.status === 'settled' || d.status === 'declined') continue;
    const debtPayments = payments.filter((p) => p.debt_id === d.id);
    const calc = calculateDebtBalance(d, debtPayments);
    if (filterDirection === 'they_owe') {
      filteredBalance += calc.currentBalance;
    } else if (filterDirection === 'you_owe') {
      filteredBalance += calc.currentBalance;
    } else {
      if (d.lender_id === currentUserId) {
        filteredBalance += calc.currentBalance;
      } else {
        filteredBalance -= calc.currentBalance;
      }
    }
  }

  const hasActiveDebts = debts.some((d) => d.status === 'active');

  if (loading) {
    return (
      <div className="py-20 text-center font-mono text-xs text-on-surface-variant flex items-center justify-center gap-2">
        <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <span>Loading ledger details...</span>
      </div>
    );
  }

  if (!personId) {
    return (
      <div className="py-20 text-center">
        <p className="font-mono text-xs text-on-surface-variant">No person specified.</p>
        <Link href="/directory" className="text-primary font-bold text-xs mt-2 inline-block">
          Return to Directory
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Back Link */}
      <Link
        href="/directory"
        className="inline-flex items-center gap-1 font-mono text-xs text-on-surface-variant hover:text-primary uppercase tracking-wider font-semibold transition-colors"
      >
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        <span>Back to Directory</span>
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/30 shadow-sm">
        <div className="flex items-center gap-4">
          <Avatar
            src={person?.avatar_url}
            name={person?.full_name || person?.email || 'User'}
            size="lg"
            className="rounded-2xl shadow-inner border border-outline-variant/20"
          />
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-heading text-xl md:text-2xl font-bold text-on-surface">
                {person?.full_name || person?.email || 'Contact Ledger'}
              </h1>
              <Chip
                label={netBalance !== 0 ? 'Active' : 'Settled'}
                variant={netBalance !== 0 ? 'active' : 'settled'}
              />
            </div>
            <p className="font-mono text-xs text-on-surface-variant mt-1">
              {person?.email} {person?.phone && `• ${person?.phone}`}
            </p>
            {person?.secondary_emails && person.secondary_emails.length > 0 && (
              <p className="font-mono text-[11px] text-[var(--outline)] mt-0.5 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">school</span>
                <span>Secondary: {person.secondary_emails.join(', ')}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2.5 flex-wrap items-center">
          {hasActiveDebts && (
            <button
              onClick={() => setIsBulkModalOpen(true)}
              className="py-2.5 px-4 rounded-xl bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-95 shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
              title="Bulk repay multiple debts"
            >
              <span className="material-symbols-outlined text-[18px]">bolt</span>
              <span>Bulk Repay</span>
            </button>
          )}
          <button
            onClick={() => setIsRecordDebtOpen(true)}
            className="py-2.5 px-4 rounded-xl border border-outline-variant/30 bg-surface-container-low text-on-surface font-mono text-xs font-bold hover:bg-surface-container shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Record Debt</span>
          </button>
        </div>
      </div>

      {/* Main Details Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start">
              <div>
                <span className="font-mono text-xs text-on-surface-variant uppercase tracking-wider font-semibold">
                  Total Outstanding Balance
                </span>
                <div
                  className={`font-heading text-3xl md:text-4xl font-bold mt-2 ${
                    isNetPositive ? 'text-secondary' : netBalance < 0 ? 'text-error' : 'text-on-surface'
                  }`}
                >
                  {isNetPositive ? '+' : ''}
                  {formatCurrency(netBalance, currency, { showDecimals: true })}
                </div>
              </div>

              <div className="text-right">
                <span className="font-mono text-xs text-on-surface-variant uppercase tracking-wider font-semibold block">
                  Role Breakdown
                </span>
                <div className="font-mono text-xs text-on-surface mt-1">
                  <div>They owe you: <span className="font-bold text-secondary">{formatCurrency(totalOutstandingLent, currency)}</span></div>
                  <div>You owe them: <span className="font-bold text-error">{formatCurrency(totalOutstandingBorrowed, currency)}</span></div>
                </div>
              </div>
            </div>

            {/* Financial Breakdown 3-Way Split Bar */}
            <div className="mt-8">
              <div className="flex justify-between text-xs font-mono text-on-surface-variant mb-2">
                <span>Principal: {formatCurrency(remainingPrincipal, currency)}</span>
                <span>Interest: +{formatCurrency(accruedInterest, currency, { showDecimals: true })}</span>
                <span>Repaid: {formatCurrency(totalPaid, currency)}</span>
              </div>
              <div className="w-full h-3 bg-surface-container rounded-full overflow-hidden flex">
                <div
                  className="bg-primary h-full transition-all"
                  style={{ width: `${principalPct}%` }}
                  title={`Principal: ${principalPct}%`}
                />
                <div
                  className="bg-secondary h-full transition-all"
                  style={{ width: `${interestPct}%` }}
                  title={`Interest: ${interestPct}%`}
                />
                <div
                  className="bg-emerald-400 h-full transition-all"
                  style={{ width: `${paidPct}%` }}
                  title={`Repaid: ${paidPct}%`}
                />
              </div>
              <div className="flex items-center gap-4 text-[11px] font-mono text-on-surface-variant mt-2">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-primary" /> Principal ({principalPct}%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-secondary" /> Interest ({interestPct}%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> Repaid ({paidPct}%)
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-outline-variant/20 flex items-center justify-between text-xs font-mono text-on-surface-variant">
            <span>{debts.length} agreements recorded</span>
            <span>{payments.length} repayments logged</span>
          </div>
        </div>

        {/* Right Col: Agreement Terms */}
        <div className="lg:col-span-4 bg-surface-container-low rounded-2xl p-6 border border-outline-variant/20 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-mono text-xs uppercase tracking-wider font-semibold text-on-surface-variant mb-4">
              Agreement Terms
            </h3>

            {debts.length > 0 ? (() => {
              const primaryAgreement = debts.find((d) => d.status !== 'declined') || debts[0];
              return (
                <div className="space-y-3 font-mono text-xs">
                  <div className="flex justify-between pb-2 border-b border-outline-variant/10">
                    <span className="text-on-surface-variant">Interest Engine</span>
                    <span className="font-bold uppercase text-on-surface">
                      {primaryAgreement.interest_type}
                    </span>
                  </div>
                  {primaryAgreement.interest_type !== 'none' && (
                    <>
                      <div className="flex justify-between pb-2 border-b border-outline-variant/10">
                        <span className="text-on-surface-variant">Rate (APR)</span>
                        <span className="font-bold text-primary">
                          {primaryAgreement.interest_rate}%
                        </span>
                      </div>
                      <div className="flex justify-between pb-2 border-b border-outline-variant/10">
                        <span className="text-on-surface-variant">Compounding</span>
                        <span className="font-bold uppercase text-on-surface">
                          {primaryAgreement.compound_freq || 'Monthly'}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between pb-2 border-b border-outline-variant/10">
                    <span className="text-on-surface-variant">Origination</span>
                    <span className="font-semibold text-on-surface">
                      {new Date(primaryAgreement.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Agreement Status</span>
                    <Chip
                      label={primaryAgreement.status}
                      variant={
                        primaryAgreement.status === 'active'
                          ? 'active'
                          : primaryAgreement.status === 'settled'
                          ? 'settled'
                          : primaryAgreement.status === 'pending'
                          ? 'pending'
                          : primaryAgreement.status === 'declined'
                          ? 'declined'
                          : 'default'
                      }
                    />
                  </div>
                </div>
              );
            })() : (
              <p className="font-mono text-xs text-on-surface-variant">
                No active agreements found
              </p>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-outline-variant/20">
            <button
              onClick={() => setIsRecordDebtOpen(true)}
              className="w-full py-2.5 px-4 rounded-xl border border-outline-variant/30 font-mono text-xs font-bold text-on-surface hover:bg-surface-container transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              <span>Add Another Loan</span>
            </button>
          </div>
        </div>
      </section>

      {/* Ledger Growth & Interest Trajectory Chart */}
      <PersonAnalyticsChart
        debts={debts}
        payments={payments}
        currentUserId={currentUserId || ''}
        currency={currency}
        personName={person?.full_name || person?.email || 'Counterparty'}
      />

      {/* Individual Debts Listing */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="font-heading text-lg font-bold text-on-surface">
              Individual Debts with Counterparty
            </h3>
            <p className="font-mono text-xs text-on-surface-variant mt-0.5">
              Filter by direction or execute automated batch repayments
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-[16px] text-on-surface-variant">
                search
              </span>
              <input
                type="text"
                placeholder="Search notes, terms, amounts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 rounded-xl border border-outline-variant/30 bg-surface-container-low text-xs text-on-surface outline-none focus:border-primary w-52 sm:w-64 font-mono"
              />
            </div>
            {hasActiveDebts && (
              <button
                onClick={() => setIsBulkModalOpen(true)}
                className="py-2 px-3.5 rounded-xl bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-95 shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                title="Bulk repay multiple debts"
              >
                <span className="material-symbols-outlined text-[16px]">bolt</span>
                <span>Bulk Repay</span>
              </button>
            )}
          </div>
        </div>

        {/* Directional Tabs and Dynamic Sum Pill */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-outline-variant/20">
          <div className="flex bg-surface-container p-1 rounded-xl border border-outline-variant/20 self-start">
            <button
              onClick={() => setFilterDirection('all')}
              className={`px-3 py-1.5 font-mono text-xs font-bold rounded-lg tracking-wider transition-all cursor-pointer ${
                filterDirection === 'all'
                  ? 'bg-surface-container-lowest text-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              All ({visibleDebts.length})
            </button>
            <button
              onClick={() => setFilterDirection('they_owe')}
              className={`px-3 py-1.5 font-mono text-xs font-bold rounded-lg tracking-wider transition-all cursor-pointer ${
                filterDirection === 'they_owe'
                  ? 'bg-surface-container-lowest text-secondary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              They Owe ({theyOweDebts.length})
            </button>
            <button
              onClick={() => setFilterDirection('you_owe')}
              className={`px-3 py-1.5 font-mono text-xs font-bold rounded-lg tracking-wider transition-all cursor-pointer ${
                filterDirection === 'you_owe'
                  ? 'bg-surface-container-lowest text-error shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              You Owe ({youOweDebts.length})
            </button>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs px-3 py-1.5 rounded-xl bg-surface-container-low border border-outline-variant/20">
            <span className="text-on-surface-variant">Balance:</span>
            <span className={`font-bold ${
              filterDirection === 'they_owe'
                ? 'text-secondary'
                : filterDirection === 'you_owe'
                ? 'text-error'
                : filteredBalance > 0
                ? 'text-secondary'
                : filteredBalance < 0
                ? 'text-error'
                : 'text-on-surface'
            }`}>
              {filterDirection === 'all' && filteredBalance > 0 ? '+' : ''}
              {formatCurrency(filteredBalance, currency, { showDecimals: true })}
            </span>
          </div>
        </div>

        {displayDebts.length === 0 ? (
          <p className="text-xs font-mono text-on-surface-variant py-4">No records found for this filter.</p>
        ) : (
          <div className="space-y-4">
            {displayDebts.map((d) => {
              const isLender = d.lender_id === currentUserId;
              const isIncomingPending = d.status === 'pending' && d.created_by !== currentUserId;
              const isOutgoingPending = d.status === 'pending' && d.created_by === currentUserId;
              const debtPayments = payments.filter((p) => p.debt_id === d.id);
              const calc = calculateDebtBalance(d, debtPayments);
              const dueDateInfo = getDueDateInfo(d.due_date, d.status);

              return (
                <div
                  key={d.id}
                  className={`p-4 rounded-xl border ${
                    isIncomingPending
                      ? 'border-amber-500/40 bg-amber-500/5'
                      : d.status === 'declined'
                      ? 'border-red-500/20 bg-surface-container-low/40 opacity-85'
                      : 'border-outline-variant/20 bg-surface-container-low'
                  } flex flex-col sm:flex-row sm:items-center justify-between gap-4`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {d.status === 'declined' ? (
                        <span className="font-mono text-xs font-bold inline-flex items-center gap-1 text-red-500 dark:text-red-400">
                          <span className="material-symbols-outlined text-[14px]">block</span>
                          Declined
                        </span>
                      ) : (
                        <span className={`font-mono text-xs font-bold ${isLender ? 'text-secondary' : 'text-error'}`}>
                          {isLender ? 'You Lent' : 'You Borrowed'}
                        </span>
                      )}
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
                          <span className="material-symbols-outlined text-[12px]">
                            {dueDateInfo.isOverdue ? 'warning' : 'event'}
                          </span>
                          {dueDateInfo.text}
                        </span>
                      )}
                      {isIncomingPending && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500 font-semibold uppercase">
                          Action Required
                        </span>
                      )}
                    </div>

                    <div className="font-mono text-sm font-bold text-on-surface mt-1">
                      {d.status === 'declined' ? (
                        <span className="text-red-500/80 dark:text-red-400/80 line-through text-xs font-mono">
                          Void
                        </span>
                      ) : (
                        formatCurrency(calc.currentBalance, d.currency || currency, { showDecimals: true })
                      )}
                      <span className="text-xs font-normal text-on-surface-variant ml-2">
                        (Orig: {d.status === 'declined' ? (
                          <span className="line-through">{formatCurrency(d.principal, d.currency || currency)}</span>
                        ) : (
                          formatCurrency(d.principal, d.currency || currency)
                        )})
                      </span>
                    </div>

                    {/* Two-Sided Notes Display */}
                    {(d.notes || d.counterparty_notes) && (
                      <div className="space-y-1 mt-2 pt-2 border-t border-outline-variant/10 text-xs">
                        {d.notes && (
                          <div className="flex items-start gap-1.5 text-on-surface-variant">
                            <span className="material-symbols-outlined text-[15px] text-primary shrink-0 mt-0.5">
                              edit_note
                            </span>
                            <span>
                              <strong className="text-on-surface">Creator:</strong> {d.notes}
                            </span>
                          </div>
                        )}
                        {d.counterparty_notes && (
                          <div className="flex items-start gap-1.5 text-on-surface-variant">
                            <span className="material-symbols-outlined text-[15px] text-secondary shrink-0 mt-0.5">
                              quick_reference_all
                            </span>
                            <span>
                              <strong className="text-on-surface">Counterparty:</strong> {d.counterparty_notes}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {isOutgoingPending && (
                      <p className="text-[11px] font-mono text-on-surface-variant mt-2 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[14px] text-amber-500">schedule</span>
                        Waiting for {person?.full_name || 'counterparty'} to review &amp; accept
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
                    {/* Two-sided Note Button */}
                    <button
                      onClick={() => setSelectedDebtForNote(d)}
                      className="py-1.5 px-2.5 rounded-lg border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:bg-surface-container font-mono text-xs flex items-center gap-1 transition-colors cursor-pointer"
                      title="View or edit 2-sided notes"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {d.notes || d.counterparty_notes ? 'note' : 'add_comment'}
                      </span>
                      <span>{d.notes || d.counterparty_notes ? 'Notes' : '+ Note'}</span>
                    </button>

                    {/* Dismiss Declined Debt from active UI */}
                    {d.status === 'declined' && (
                      <button
                        onClick={() => handleDismissDeclinedDebt(d.id, d.hidden_by || [])}
                        className="py-1.5 px-2.5 rounded-lg border border-outline-variant/30 text-on-surface-variant hover:text-error hover:border-error/30 font-mono text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                        title="Dismiss from your view (persists in activity log audit trail)"
                      >
                        <span className="material-symbols-outlined text-[14px]">visibility_off</span>
                        <span>Dismiss</span>
                      </button>
                    )}

                    {isIncomingPending && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleAcceptDebt(d.id, 'active')}
                          className="py-1.5 px-3 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer shadow-sm flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[14px]">check_circle</span>
                          Accept
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Are you sure you want to decline this agreement?')) {
                              handleAcceptDebt(d.id, 'declined');
                            }
                          }}
                          className="py-1.5 px-3 rounded-lg border border-error/30 text-error font-mono text-xs font-bold hover:bg-error/10 transition-colors cursor-pointer"
                        >
                          Decline
                        </button>
                      </div>
                    )}

                    {d.status === 'active' && calc.currentBalance > 0 && (
                      <button
                        onClick={() => setActiveDebtForPayment({ debt: d, balance: calc.currentBalance })}
                        className="py-1.5 px-3 rounded-lg bg-secondary text-on-secondary font-mono text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
                      >
                        Record Payment
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Repayments & Verification Section */}
      {payments.length > 0 && (
        <section className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-heading text-lg font-bold text-on-surface">
                Repayment Receipts &amp; Verifications
              </h3>
              <p className="font-mono text-xs text-on-surface-variant mt-0.5">
                Two-way receipt verification log for all payments made on these debts
              </p>
            </div>
            <span className="font-mono text-xs px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant">
              {payments.length} payment{payments.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="space-y-3">
            {payments.map((p) => {
              const matchedDebt = debts.find((d) => d.id === p.debt_id);
              const isLenderOfDebt = matchedDebt?.lender_id === currentUserId;
              const isPending = (p as any).is_verified === false;

              return (
                <div
                  key={p.id}
                  className={`p-3.5 rounded-xl border ${
                    isPending
                      ? 'border-amber-500/30 bg-amber-500/5'
                      : 'border-outline-variant/20 bg-surface-container-low'
                  } flex flex-col sm:flex-row sm:items-center justify-between gap-3`}
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-on-surface">
                        {formatCurrency(Number(p.amount), p.currency || currency, { showDecimals: true })}
                      </span>
                      {isPending ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">schedule</span>
                          Pending Lender Verification
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">verified</span>
                          Verified Receipt
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-on-surface-variant mt-1 flex items-center gap-3">
                      <span>{new Date(p.created_at).toLocaleString()}</span>
                      {p.note && <span className="font-mono text-[11px] italic">"{p.note}"</span>}
                    </div>
                  </div>

                  {isPending && isLenderOfDebt && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleVerifyRepayment(p.id, 'verified')}
                        disabled={verifyingPaymentId === p.id}
                        className="py-1.5 px-3 rounded-lg bg-emerald-600 text-white font-mono text-xs font-bold hover:bg-emerald-700 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[14px]">check</span>
                        <span>Verify Receipt</span>
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Dispute this unverified repayment?')) {
                            handleVerifyRepayment(p.id, 'disputed');
                          }
                        }}
                        disabled={verifyingPaymentId === p.id}
                        className="py-1.5 px-3 rounded-lg border border-red-500/30 text-red-600 dark:text-red-400 font-mono text-xs font-semibold hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Dispute
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Activity Log Stepper */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 shadow-sm">
        <h3 className="font-heading text-lg font-bold text-on-surface mb-6">
          Activity Log &amp; Audit Trail
        </h3>

        {activityLogs.length === 0 ? (
          <p className="font-mono text-xs text-on-surface-variant py-4">
            No activity logged yet.
          </p>
        ) : (
          <div className="relative pl-6 space-y-6 before:content-[''] before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-outline-variant/30">
            {activityLogs.map((log) => {
              let dotColor = 'bg-outline';
              let title = log.action;

              if (log.action === 'payment_made') {
                dotColor = 'bg-secondary';
                title = `Payment Received (${formatCurrency(Number((log.details as any)?.amount || 0), currency)})`;
              } else if (log.action === 'repayment_reported') {
                dotColor = 'bg-amber-500';
                title = `Repayment Reported (${formatCurrency(Number((log.details as any)?.amount || 0), currency)})`;
              } else if (log.action === 'payment_verified') {
                dotColor = 'bg-emerald-500';
                title = 'Repayment Verified by Lender';
              } else if (log.action === 'creator_note_updated') {
                dotColor = 'bg-primary';
                title = 'Creator Note Updated';
              } else if (log.action === 'counterparty_note_updated') {
                dotColor = 'bg-secondary';
                title = 'Counterparty Note Updated';
              } else if (log.action === 'debt_created') {
                dotColor = 'bg-primary';
                title = `Debt Record Created (Principal: ${formatCurrency(Number((log.details as any)?.principal || 0), currency)})`;
              } else if (log.action === 'debt_accepted') {
                dotColor = 'bg-success';
                title = 'Agreement Accepted by Counterparty';
              }

              return (
                <div key={log.id} className="relative group">
                  <div
                    className={`absolute -left-[23px] top-1 w-3 h-3 rounded-full ${dotColor} ring-4 ring-surface-container-lowest`}
                  />
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div className="font-heading font-semibold text-sm text-on-surface">
                      {title}
                    </div>
                    <div className="font-mono text-[11px] text-on-surface-variant">
                      {new Date(log.created_at).toLocaleString()}
                    </div>
                  </div>
                  {log.details && (log.details as any).note && (
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      {(log.details as any).note}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Payment Modal */}
      {activeDebtForPayment && (
        <PaymentModal
          isOpen={!!activeDebtForPayment}
          debt={activeDebtForPayment.debt}
          currentBalance={activeDebtForPayment.balance}
          onClose={() => setActiveDebtForPayment(null)}
          onPaymentRecorded={fetchDetails}
        />
      )}

      {/* Counterparty Note Modal */}
      {selectedDebtForNote && (
        <CounterpartyNoteModal
          isOpen={Boolean(selectedDebtForNote)}
          debt={selectedDebtForNote}
          currentUserId={currentUserId || ''}
          onClose={() => setSelectedDebtForNote(null)}
          onNoteUpdated={fetchDetails}
        />
      )}

      {/* Record Debt Modal */}
      <RecordDebtModal
        isOpen={isRecordDebtOpen}
        preselectedContactId={personId}
        onClose={() => setIsRecordDebtOpen(false)}
        onDebtCreated={fetchDetails}
      />

      {/* Bulk Payment Modal */}
      {isBulkModalOpen && (
        <BulkPaymentModal
          isOpen={isBulkModalOpen}
          onClose={() => setIsBulkModalOpen(false)}
          debts={debts}
          payments={payments}
          currentUserId={currentUserId || ''}
          currency={currency}
          personName={person?.full_name || person?.email || 'Counterparty'}
          onPaymentCompleted={() => {
            fetchDetails();
          }}
        />
      )}
    </div>
  );
}

export default function PersonDebtDetailPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center font-mono text-xs text-on-surface-variant">Loading...</div>}>
      <PersonDebtDetailContent />
    </Suspense>
  );
}
