'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment, ActivityLogEntry } from '@/lib/types/database';
import { calculateDebtBalance, round2 } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { Chip } from '../ui/Chip';
import { Avatar } from '../ui/Avatar';
import { getDueDateInfo } from '@/lib/utils/due-date';
import { PaymentModal } from './PaymentModal';
import { CounterpartyNoteModal } from './CounterpartyNoteModal';
import { formatPaymentMethodDisplay } from '@/lib/utils/upi-link';

export interface DebtDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  debt: Debt | null;
  currentUserId: string;
  currency?: string;
  onDebtUpdated?: () => void;
}

export function DebtDetailModal({
  isOpen,
  onClose,
  debt,
  currentUserId,
  currency = 'inr',
  onDebtUpdated,
}: DebtDetailModalProps) {
  const supabase = createClient();

  const [loading, setLoading] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [verifyingPaymentId, setVerifyingPaymentId] = useState<string | null>(null);

  // Sub-modals
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);

  const fetchDebtDetails = useCallback(async () => {
    if (!debt) return;
    setLoading(true);
    try {
      const [paymentsRes, logsRes] = await Promise.all([
        supabase
          .from('payments')
          .select(`
            *,
            payer:profiles!payments_paid_by_fkey(id, full_name, email, avatar_url)
          `)
          .eq('debt_id', debt.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('activity_log')
          .select('*')
          .eq('debt_id', debt.id)
          .order('created_at', { ascending: false }),
      ]);

      setPayments((paymentsRes.data as any) || []);
      setActivityLogs((logsRes.data as any) || []);
    } catch (err) {
      console.error('Error loading debt details modal data:', err);
    } finally {
      setLoading(false);
    }
  }, [debt, supabase]);

  useEffect(() => {
    if (isOpen && debt) {
      fetchDebtDetails();
    }
  }, [isOpen, debt, fetchDebtDetails]);

  if (!debt) return null;

  const isLender = debt.lender_id === currentUserId;
  const otherPerson = isLender ? debt.borrower : debt.lender;
  const otherName = otherPerson?.full_name || otherPerson?.email || 'Counterparty';
  const calc = calculateDebtBalance(debt, payments);
  const dueDateInfo = getDueDateInfo(debt.due_date, debt.status);
  const debtCurrency = debt.currency || currency;

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
        const paymentItem = payments.find((p) => p.id === paymentId);

        if (decision === 'verified') {
          await supabase
            .from('payments')
            .update({
              is_verified: true,
              verified_at: new Date().toISOString(),
              verified_by: currentUserId,
            })
            .eq('id', paymentId);

          const updatedPayments = payments.map((p) =>
            p.id === paymentId ? { ...p, is_verified: true } : p
          );
          const newCalc = calculateDebtBalance(debt, updatedPayments);

          if (newCalc.currentBalance <= 0.01) {
            await supabase
              .from('debts')
              .update({
                status: 'settled',
                settled_at: new Date().toISOString(),
              })
              .eq('id', debt.id);

            // Auto-purge other lingering unverified payments for this settled debt
            await supabase
              .from('payments')
              .delete()
              .eq('debt_id', debt.id)
              .eq('is_verified', false);
          }
        } else {
          // Lender disputes repayment
          const existingNote = paymentItem?.note || '';
          const disputedNote = existingNote.includes('[DISPUTED]')
            ? existingNote
            : (existingNote ? `${existingNote} [DISPUTED]` : 'Disputed by lender [DISPUTED]');

          await supabase
            .from('payments')
            .update({
              is_verified: false,
              verified_at: new Date().toISOString(),
              verified_by: currentUserId,
              note: disputedNote,
            })
            .eq('id', paymentId);

          if (currentUserId) {
            await supabase.from('activity_log').insert({
              user_id: currentUserId,
              debt_id: debt.id,
              action: 'payment_disputed',
              details: {
                amount: paymentItem?.amount,
                note: disputedNote,
                disputed_by: currentUserId,
              },
            });
          }
        }
      }

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      await fetchDebtDetails();
      onDebtUpdated?.();
    } catch (err: any) {
      console.error('Error verifying repayment:', err);
      alert(err.message || 'Failed to process repayment verification');
    } finally {
      setVerifyingPaymentId(null);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Debt Agreement & Audit Trail"
        subtitle={`ID: ${debt.id.substring(0, 8)} • Recorded on ${new Date(debt.created_at).toLocaleDateString()}`}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-6">
          {/* Header Card: Counterparty & Position */}
          <div className="p-4 rounded-2xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Avatar src={otherPerson?.avatar_url} name={otherName} size="md" />
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-heading font-bold text-base text-[var(--on-surface)]">
                    {otherName}
                  </span>
                  <Chip
                    label={debt.status}
                    variant={
                      debt.status === 'active'
                        ? 'active'
                        : debt.status === 'settled'
                        ? 'settled'
                        : debt.status === 'pending'
                        ? 'pending'
                        : debt.status === 'declined'
                        ? 'declined'
                        : 'default'
                    }
                  />
                  {dueDateInfo && debt.status !== 'declined' && (
                    <span
                      className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-semibold border ${dueDateInfo.className} flex items-center gap-1`}
                    >
                      <span className="material-symbols-outlined text-[12px]">
                        {dueDateInfo.isOverdue ? 'warning' : 'event'}
                      </span>
                      {dueDateInfo.text}
                    </span>
                  )}
                </div>
                <div className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
                  {otherPerson?.email}
                </div>
              </div>
            </div>

            <div className="sm:text-right">
              <span
                className={`font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1 ${
                  isLender ? 'text-[var(--secondary)]' : 'text-[var(--error)]'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {isLender ? 'arrow_upward' : 'arrow_downward'}
                </span>
                {isLender ? 'You Lent (Receivable)' : 'You Borrowed (Payable)'}
              </span>
              <div className="font-mono text-xl font-bold text-[var(--on-surface)] mt-0.5">
                {debt.status === 'declined' ? (
                  <span className="text-red-500 line-through text-sm">Void</span>
                ) : (
                  formatCurrency(calc.currentBalance, debtCurrency, { showDecimals: true })
                )}
              </div>
            </div>
          </div>

          {/* Financial Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--outline-variant)]/30">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--on-surface-variant)]">
                Principal
              </div>
              <div className="font-mono text-sm font-bold text-[var(--on-surface)] mt-1">
                {formatCurrency(calc.principal, debtCurrency, { showDecimals: true })}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--outline-variant)]/30">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--on-surface-variant)]">
                Interest Terms
              </div>
              <div className="font-mono text-sm font-bold text-[var(--on-surface)] mt-1">
                {debt.interest_type === 'none'
                  ? '0% None'
                  : `${debt.interest_rate}% ${debt.interest_type}${debt.interest_type === 'compound' ? ` (${debt.compound_freq || 'monthly'})` : ''}`}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--outline-variant)]/30">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--on-surface-variant)]">
                Accrued Interest
              </div>
              <div className="font-mono text-sm font-bold text-[var(--on-surface)] mt-1">
                {formatCurrency(calc.totalAccruedInterest, debtCurrency, { showDecimals: true })}
              </div>
              {calc.totalAccruedInterest === 0 && calc.rawAccruedInterest > 0 && (
                <div className="text-[9px] font-mono text-[var(--on-surface-variant)] mt-0.5 italic">
                  &lt;0.01 unaccrued
                </div>
              )}
            </div>

            <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--outline-variant)]/30">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--on-surface-variant)]">
                Total Verified Paid
              </div>
              <div className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {formatCurrency(calc.totalPaid, debtCurrency, { showDecimals: true })}
              </div>
            </div>
          </div>

          {/* Pending / Disputed Repayment Warning Banners */}
          {(calc.pendingVerificationPaid || 0) > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-amber-500">
                  pending_actions
                </span>
                <span>
                  <strong>Pending Verification:</strong>{' '}
                  <span className="font-mono font-bold">
                    {formatCurrency(calc.pendingVerificationPaid || 0, debtCurrency, { showDecimals: true })}
                  </span>{' '}
                  awaiting lender review.
                </span>
              </div>
            </div>
          )}

          {(calc.disputedPaid || 0) > 0 && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-red-500">
                error_outline
              </span>
              <span>
                <strong>Disputed Repayments:</strong>{' '}
                <span className="font-mono font-bold">
                  {formatCurrency(calc.disputedPaid || 0, debtCurrency, { showDecimals: true })}
                </span>{' '}
                marked as disputed by lender.
              </span>
            </div>
          )}

          {/* Two-Sided Notes Section */}
          <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--on-surface-variant)]">
                Agreement Notes
              </span>
              <button
                type="button"
                onClick={() => setIsNoteModalOpen(true)}
                className="font-mono text-xs text-[var(--primary)] font-bold hover:underline flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">edit_note</span>
                Edit Notes
              </button>
            </div>

            {debt.notes || debt.counterparty_notes ? (
              <div className="space-y-2 text-xs">
                {debt.notes && (
                  <div className="flex items-start gap-2 text-[var(--on-surface-variant)] bg-[var(--surface-container-low)] p-2.5 rounded-lg border border-[var(--outline-variant)]/20">
                    <span className="material-symbols-outlined text-[16px] text-[var(--primary)] shrink-0 mt-0.5">
                      edit_note
                    </span>
                    <div>
                      <strong className="text-[var(--on-surface)] block mb-0.5">Creator Note:</strong>
                      <span>{debt.notes}</span>
                    </div>
                  </div>
                )}
                {debt.counterparty_notes && (
                  <div className="flex items-start gap-2 text-[var(--on-surface-variant)] bg-[var(--surface-container-low)] p-2.5 rounded-lg border border-[var(--outline-variant)]/20">
                    <span className="material-symbols-outlined text-[16px] text-[var(--secondary)] shrink-0 mt-0.5">
                      quick_reference_all
                    </span>
                    <div>
                      <strong className="text-[var(--on-surface)] block mb-0.5">Counterparty Note:</strong>
                      <span>{debt.counterparty_notes}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-[var(--on-surface-variant)] italic">
                No personal or counterparty notes recorded yet.
              </div>
            )}
          </div>

          {/* Repayment Receipts & Transactions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-heading font-bold text-sm text-[var(--on-surface)]">
                Repayment Receipts &amp; Transactions ({payments.length})
              </h4>
              {debt.status === 'active' && calc.currentBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(true)}
                  className="font-mono text-xs text-[var(--secondary)] font-bold hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">add_circle</span>
                  {isLender ? 'Record Payment' : 'Report Repayment'}
                </button>
              )}
            </div>

            {payments.length === 0 ? (
              <div className="p-4 rounded-xl border border-[var(--outline-variant)]/20 text-center font-mono text-xs text-[var(--on-surface-variant)]">
                No payments or repayments recorded yet for this agreement.
              </div>
            ) : (
              <div className="space-y-2.5">
                {payments.map((p) => {
                  const isDisputed =
                    (p as any).status === 'disputed' ||
                    ((p as any).is_verified === false && (p as any).verified_at != null) ||
                    (typeof p.note === 'string' && p.note.includes('[DISPUTED]'));
                  const isPending = (p as any).is_verified === false && !isDisputed;
                  const isVerified = (p as any).is_verified === true;

                  return (
                    <div
                      key={p.id}
                      className={`p-3 rounded-xl border ${
                        isPending
                          ? 'border-amber-500/30 bg-amber-500/5'
                          : isDisputed
                          ? 'border-red-500/20 bg-red-500/5'
                          : 'border-[var(--outline-variant)]/20 bg-[var(--surface-container-low)]'
                      } flex flex-col sm:flex-row sm:items-center justify-between gap-3`}
                    >
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-[var(--on-surface)]">
                            {formatCurrency(Number(p.amount), p.currency || debtCurrency, { showDecimals: true })}
                          </span>

                          {isVerified && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">verified</span>
                              Verified Receipt
                            </span>
                          )}

                          {isPending && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">schedule</span>
                              Pending Lender Verification
                            </span>
                          )}

                          {isDisputed && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">error</span>
                              Receipt Disputed by Lender
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-[var(--on-surface-variant)] mt-1 flex items-center gap-3 flex-wrap">
                          <span>{new Date(p.created_at).toLocaleString()}</span>
                          {(p as any).payment_method && (() => {
                            const disp = formatPaymentMethodDisplay((p as any).payment_method, (p as any).transaction_ref);
                            return (
                              <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border ${disp.badgeClass} flex items-center gap-1`}>
                                <span className="material-symbols-outlined text-[12px]">{disp.icon}</span>
                                <span>{disp.fullLabel}</span>
                              </span>
                            );
                          })()}
                          {(p as any).transaction_ref && (
                            <span className="font-mono text-[11px] text-[var(--primary)] flex items-center gap-1">
                              <span>UTR: {(p as any).transaction_ref}</span>
                            </span>
                          )}
                          {p.note && <span className="font-mono text-[11px] italic">"{p.note}"</span>}
                        </div>
                      </div>

                      {isPending && isLender && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleVerifyRepayment(p.id, 'verified')}
                            disabled={verifyingPaymentId === p.id}
                            className="py-1 px-2.5 rounded-lg bg-emerald-600 text-white font-mono text-xs font-bold hover:bg-emerald-700 transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer shadow-xs"
                          >
                            <span className="material-symbols-outlined text-[14px]">check</span>
                            <span>Verify</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm('Dispute this unverified repayment receipt?')) {
                                handleVerifyRepayment(p.id, 'disputed');
                              }
                            }}
                            disabled={verifyingPaymentId === p.id}
                            className="py-1 px-2.5 rounded-lg border border-red-500/30 text-red-600 dark:text-red-400 font-mono text-xs font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            Dispute
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Activity Log & Audit Trail */}
          <div className="space-y-3">
            <h4 className="font-heading font-bold text-sm text-[var(--on-surface)]">
              Chronological Audit Trail
            </h4>

            {activityLogs.length === 0 ? (
              <div className="p-4 rounded-xl border border-[var(--outline-variant)]/20 text-center font-mono text-xs text-[var(--on-surface-variant)]">
                No activity logged yet for this debt.
              </div>
            ) : (
              <div className="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--outline-variant)]/30">
                {activityLogs.map((log) => {
                  let dotColor = 'bg-[var(--outline)]';
                  let title = log.action;

                  if (log.action === 'payment_made') {
                    dotColor = 'bg-[var(--secondary)]';
                    title = `Payment Received (${formatCurrency(Number((log.details as any)?.amount || 0), debtCurrency)})`;
                  } else if (log.action === 'repayment_reported') {
                    dotColor = 'bg-amber-500';
                    title = `Repayment Reported (${formatCurrency(Number((log.details as any)?.amount || 0), debtCurrency)})`;
                  } else if (log.action === 'payment_verified') {
                    dotColor = 'bg-emerald-500';
                    title = 'Repayment Verified by Lender';
                  } else if (log.action === 'payment_disputed') {
                    dotColor = 'bg-red-500';
                    title = `Repayment Disputed by Lender (${formatCurrency(Number((log.details as any)?.amount || 0), debtCurrency)})`;
                  } else if (log.action === 'creator_note_updated') {
                    dotColor = 'bg-[var(--primary)]';
                    title = 'Creator Note Updated';
                  } else if (log.action === 'counterparty_note_updated') {
                    dotColor = 'bg-[var(--secondary)]';
                    title = 'Counterparty Note Updated';
                  } else if (log.action === 'debt_created') {
                    dotColor = 'bg-[var(--primary)]';
                    title = `Debt Agreement Created (Principal: ${formatCurrency(Number((log.details as any)?.principal || debt.principal), debtCurrency)})`;
                  } else if (log.action === 'debt_accepted') {
                    dotColor = 'bg-emerald-500';
                    title = 'Agreement Accepted by Counterparty';
                  } else if (log.action === 'debt_settled') {
                    dotColor = 'bg-emerald-500';
                    title = 'Debt Agreement Fully Settled';
                  }

                  return (
                    <div key={log.id} className="relative group">
                      <div
                        className={`absolute -left-[23px] top-1 w-2.5 h-2.5 rounded-full ${dotColor} ring-4 ring-[var(--surface)]`}
                      />
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <div className="font-heading font-semibold text-xs text-[var(--on-surface)]">
                          {title}
                        </div>
                        <div className="font-mono text-[10px] text-[var(--on-surface-variant)]">
                          {new Date(log.created_at).toLocaleString()}
                        </div>
                      </div>
                      {log.details && (log.details as any).note && (
                        <p className="text-xs text-[var(--on-surface-variant)] mt-0.5">
                          {(log.details as any).note}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Modal Footer Actions */}
          <div className="pt-4 border-t border-[var(--outline-variant)]/20 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {debt.status === 'active' && calc.currentBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(true)}
                  className="py-2 px-3.5 rounded-xl bg-[var(--secondary)] text-[var(--on-secondary)] font-mono text-xs font-bold hover:opacity-95 shadow-xs cursor-pointer"
                >
                  {isLender ? 'Record Payment' : 'Report Repayment'}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="py-2 px-4 rounded-xl border border-[var(--outline-variant)]/40 font-mono text-xs font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container)] cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      {/* Payment Modal */}
      {isPaymentModalOpen && (
        <PaymentModal
          isOpen={isPaymentModalOpen}
          debt={debt}
          currentBalance={calc.currentBalance}
          onClose={() => setIsPaymentModalOpen(false)}
          onPaymentRecorded={() => {
            fetchDebtDetails();
            onDebtUpdated?.();
          }}
        />
      )}

      {/* Counterparty Note Modal */}
      {isNoteModalOpen && (
        <CounterpartyNoteModal
          isOpen={isNoteModalOpen}
          debt={debt}
          currentUserId={currentUserId}
          onClose={() => setIsNoteModalOpen(false)}
          onNoteUpdated={() => {
            fetchDebtDetails();
            onDebtUpdated?.();
          }}
        />
      )}
    </>
  );
}
