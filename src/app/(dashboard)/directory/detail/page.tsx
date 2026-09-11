'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment, ActivityLogEntry, Profile } from '@/lib/types/database';
import { calculateDebtBalance } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { Chip } from '@/components/ui/Chip';
import { PaymentModal } from '@/components/debts/PaymentModal';
import { RecordDebtModal } from '@/components/debts/RecordDebtModal';
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

  // Modals
  const [activeDebtForPayment, setActiveDebtForPayment] = useState<{ debt: Debt; balance: number } | null>(null);
  const [isRecordDebtOpen, setIsRecordDebtOpen] = useState(false);

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

      // Currency setting
      const { data: settings } = await supabase
        .from('user_settings')
        .select('default_currency')
        .eq('user_id', user.id)
        .single();
      if (settings?.default_currency) setCurrency(settings.default_currency);

      // Fetch counterparty profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', personId)
        .single();
      setPerson(profile);

      // Fetch all debts between user and this person
      const { data: debtRows } = await supabase
        .from('debts')
        .select('*')
        .or(
          `and(lender_id.eq.${user.id},borrower_id.eq.${personId}),and(lender_id.eq.${personId},borrower_id.eq.${user.id})`
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

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

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
          <div className="w-14 h-14 rounded-2xl bg-surface-container-high text-primary font-bold text-xl flex items-center justify-center border border-outline-variant/20 shadow-inner">
            {(person?.full_name || person?.email || 'U').charAt(0).toUpperCase()}
          </div>
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
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setIsRecordDebtOpen(true)}
            className="py-2.5 px-4 rounded-xl bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-95 shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
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

            {/* Split Bar */}
            <div className="mt-8">
              <div className="flex justify-between text-xs font-mono text-on-surface-variant mb-2">
                <span>Principal: {formatCurrency(totalPrincipal, currency)}</span>
                <span>Accrued Interest: +{formatCurrency(totalAccruedInterest, currency, { showDecimals: true })}</span>
              </div>
              <div className="w-full h-3 bg-surface-container rounded-full overflow-hidden flex">
                <div
                  className="bg-primary h-full"
                  style={{
                    width: `${
                      totalPrincipal + totalAccruedInterest > 0
                        ? (totalPrincipal / (totalPrincipal + totalAccruedInterest)) * 100
                        : 100
                    }%`,
                  }}
                  title="Principal"
                />
                <div
                  className="bg-secondary-container h-full"
                  style={{
                    width: `${
                      totalPrincipal + totalAccruedInterest > 0
                        ? (totalAccruedInterest / (totalPrincipal + totalAccruedInterest)) * 100
                        : 0
                    }%`,
                  }}
                  title="Interest"
                />
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

            {debts.length > 0 ? (
              <div className="space-y-3 font-mono text-xs">
                <div className="flex justify-between pb-2 border-b border-outline-variant/10">
                  <span className="text-on-surface-variant">Interest Engine</span>
                  <span className="font-bold uppercase text-on-surface">
                    {debts[0].interest_type}
                  </span>
                </div>
                {debts[0].interest_type !== 'none' && (
                  <>
                    <div className="flex justify-between pb-2 border-b border-outline-variant/10">
                      <span className="text-on-surface-variant">Rate (APR)</span>
                      <span className="font-bold text-primary">
                        {debts[0].interest_rate}%
                      </span>
                    </div>
                    <div className="flex justify-between pb-2 border-b border-outline-variant/10">
                      <span className="text-on-surface-variant">Compounding</span>
                      <span className="font-bold uppercase text-on-surface">
                        {debts[0].compound_freq || 'Monthly'}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between pb-2 border-b border-outline-variant/10">
                  <span className="text-on-surface-variant">Origination</span>
                  <span className="font-semibold text-on-surface">
                    {new Date(debts[0].created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Agreement Status</span>
                  <Chip label={debts[0].status} variant={debts[0].status === 'active' ? 'active' : 'default'} />
                </div>
              </div>
            ) : (
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

      {/* Individual Debts Listing */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 shadow-sm">
        <h3 className="font-heading text-lg font-bold text-on-surface mb-4">
          Individual Debts with Counterparty
        </h3>

        {debts.length === 0 ? (
          <p className="text-xs font-mono text-on-surface-variant py-4">No records found.</p>
        ) : (
          <div className="space-y-4">
            {debts.map((d) => {
              const isLender = d.lender_id === currentUserId;
              const debtPayments = payments.filter((p) => p.debt_id === d.id);
              const calc = calculateDebtBalance(d, debtPayments);

              return (
                <div
                  key={d.id}
                  className="p-4 rounded-xl border border-outline-variant/20 bg-surface-container-low flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-xs font-bold ${isLender ? 'text-secondary' : 'text-error'}`}>
                        {isLender ? 'You Lent' : 'You Borrowed'}
                      </span>
                      <Chip label={d.status} variant={d.status === 'active' ? 'active' : d.status === 'settled' ? 'settled' : 'default'} />
                    </div>

                    <div className="font-mono text-sm font-bold text-on-surface mt-1">
                      {formatCurrency(calc.currentBalance, d.currency || currency, { showDecimals: true })}
                      <span className="text-xs font-normal text-on-surface-variant ml-2">
                        (Orig: {formatCurrency(d.principal, d.currency || currency)})
                      </span>
                    </div>

                    {d.notes && (
                      <p className="text-xs text-on-surface-variant mt-1">{d.notes}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-auto">
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

      {/* Record Debt Modal */}
      <RecordDebtModal
        isOpen={isRecordDebtOpen}
        preselectedContactId={personId}
        onClose={() => setIsRecordDebtOpen(false)}
        onDebtCreated={fetchDetails}
      />
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
