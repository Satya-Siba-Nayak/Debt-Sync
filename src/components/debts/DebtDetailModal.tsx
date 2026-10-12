'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment, ActivityLogEntry } from '@/lib/types/database';
import { calculateDebtBalance, round2, sortPaymentsPendingFirst } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { Chip } from '../ui/Chip';
import { Avatar } from '../ui/Avatar';
import { getDueDateInfo } from '@/lib/utils/due-date';
import { PaymentModal } from './PaymentModal';
import { CounterpartyNoteModal } from './CounterpartyNoteModal';
import { formatPaymentMethodDisplay } from '@/lib/utils/upi-link';
import {
  parseSplitDetails,
  getCleanDebtNotes,
  parseShareMetadata,
  buildDebtNotesWithMetadata,
  generateShareToken,
  TransactionShareMetadata,
} from '@/lib/utils/split-bills';
import { EditPendingDebtModal } from './EditPendingDebtModal';
import { respondToDebtAgreement } from '@/lib/utils/debt-acceptance';
import { sendNotificationEmail } from '@/lib/utils/email-notifier';

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
  debt: initialDebt,
  currentUserId,
  currency = 'inr',
  onDebtUpdated,
}: DebtDetailModalProps) {
  const supabase = createClient();

  const [internalDebt, setInternalDebt] = useState<Debt | null>(initialDebt);
  const [loading, setLoading] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [verifyingPaymentId, setVerifyingPaymentId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Share & Visibility states
  const [isShareDrawerOpen, setIsShareDrawerOpen] = useState(false);
  const [shareUpdating, setShareUpdating] = useState(false);
  const [copiedLinkType, setCopiedLinkType] = useState<'participant' | 'global' | null>(null);
  const [isCurrentUserIsolated, setIsCurrentUserIsolated] = useState(false);

  // Sub-modals
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const prevDebtIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialDebt?.id && initialDebt.id !== prevDebtIdRef.current) {
      setInternalDebt(initialDebt);
      setIsShareDrawerOpen(false);
      prevDebtIdRef.current = initialDebt.id;
    }
  }, [initialDebt]);

  const debt = internalDebt || initialDebt;

  const fetchDebtDetails = useCallback(async () => {
    if (!initialDebt?.id) return;
    setLoading(true);
    try {
      const [debtRes, paymentsRes, logsRes, myProfRes] = await Promise.all([
        supabase
          .from('debts')
          .select(`
            *,
            lender:profiles!debts_lender_id_fkey(id, full_name, email, avatar_url),
            borrower:profiles!debts_borrower_id_fkey(id, full_name, email, avatar_url)
          `)
          .eq('id', initialDebt.id)
          .single(),
        supabase
          .from('payments')
          .select(`
            *,
            payer:profiles!payments_paid_by_fkey(id, full_name, email, avatar_url)
          `)
          .eq('debt_id', initialDebt.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('activity_log')
          .select('*')
          .eq('debt_id', initialDebt.id)
          .order('created_at', { ascending: false }),
        currentUserId
          ? supabase.from('profiles').select('is_isolated').eq('id', currentUserId).single()
          : Promise.resolve({ data: null }),
      ]);

      const fetchedDebt = (debtRes.data as any) || initialDebt;
      const fetchedPayments: Payment[] = (paymentsRes.data as any) || [];
      const fetchedLogs: ActivityLogEntry[] = (logsRes.data as any) || [];

      if (debtRes.data) {
        setInternalDebt(fetchedDebt);
      }
      setPayments(fetchedPayments);
      setActivityLogs(fetchedLogs);
      if (myProfRes?.data) {
        setIsCurrentUserIsolated(Boolean((myProfRes.data as any).is_isolated));
      }

      // If global sharing is currently enabled on this debt, keep its snapshot fresh for public viewers
      const currentShare = parseShareMetadata(fetchedDebt);
      if (currentShare?.globalEnabled && currentShare.globalToken && debtRes.data) {
        const updatedShare: TransactionShareMetadata = {
          ...currentShare,
          snapshot: {
            counterpartyNotes: null,
            dueDate: fetchedDebt.due_date || null,
            settledAt: fetchedDebt.settled_at || null,
            payments: fetchedPayments.slice(0, 10).map((p: any) => ({
              id: p.id,
              amount: Number(p.amount) || 0,
              currency: p.currency || fetchedDebt.currency || 'inr',
              created_at: p.created_at,
              is_verified: p.is_verified,
              verified_at: p.verified_at || null,
              payment_method: p.payment_method || null,
              transaction_ref: p.transaction_ref || null,
              note: null,
            })),
            auditLog: fetchedLogs.slice(0, 12).map((l: any) => ({
              id: l.id,
              action: l.action,
              created_at: l.created_at,
              details: l.details || {},
            })),
            updatedAt: new Date().toISOString(),
          },
        };
        const updatedNotesStr = buildDebtNotesWithMetadata(fetchedDebt, {
          shareMetadata: updatedShare,
        });
        if (updatedNotesStr !== fetchedDebt.notes) {
          await supabase.from('debts').update({ notes: updatedNotesStr }).eq('id', fetchedDebt.id);
          setInternalDebt({ ...fetchedDebt, notes: updatedNotesStr });
        }
      }
    } catch (err) {
      console.error('Error loading debt details modal data:', err);
    } finally {
      setLoading(false);
    }
  }, [initialDebt, currentUserId, supabase]);

  useEffect(() => {
    if (isOpen && initialDebt?.id) {
      fetchDebtDetails();
    }
  }, [isOpen, initialDebt?.id, fetchDebtDetails]);

  if (!debt) return null;

  const isLender = debt.lender_id === currentUserId;
  const myPerson = isLender ? debt.lender : debt.borrower;
  const myName = myPerson?.full_name || myPerson?.email || 'Participant';
  const otherPerson = isLender ? debt.borrower : debt.lender;
  const otherName = otherPerson?.full_name || otherPerson?.email || 'Counterparty';
  const calc = calculateDebtBalance(debt, payments);
  const dueDateInfo = getDueDateInfo(debt.due_date, debt.status);
  const debtCurrency = debt.currency || currency;
  const shareMeta = parseShareMetadata(debt);
  const isGlobalShared = Boolean(shareMeta?.globalEnabled && shareMeta?.globalToken);
  const splitInfo = parseSplitDetails(debt);

  const getOrigin = () =>
    typeof window !== 'undefined' ? window.location.origin : 'https://debt-sync.satya-nayak.dev';

  const participantShareUrl = `${getOrigin()}/share?id=${debt.id}&mode=participants`;
  const globalShareUrl =
    isGlobalShared && shareMeta?.globalToken
      ? `${getOrigin()}/share?id=${debt.id}&token=${shareMeta.globalToken}`
      : '';

  const handleCopyShareLink = async (type: 'participant' | 'global', customUrl?: string) => {
    const targetUrl = customUrl || (type === 'participant' ? participantShareUrl : globalShareUrl);
    if (!targetUrl) return;
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopiedLinkType(type);
      setTimeout(() => setCopiedLinkType(null), 2500);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };

  const handleNativeShare = async (type: 'participant' | 'global') => {
    const targetUrl = type === 'participant' ? participantShareUrl : globalShareUrl;
    if (!targetUrl) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: splitInfo
            ? `DebtSync Split Bill: ${splitInfo.title}`
            : `DebtSync Agreement (${formatCurrency(debt.principal, debtCurrency)})`,
          text:
            type === 'participant'
              ? `View our transaction record on DebtSync (Restricted to participating members):`
              : `View this shared transaction record on DebtSync:`,
          url: targetUrl,
        });
        return;
      } catch (_) {}
    }
    handleCopyShareLink(type, targetUrl);
  };

  const handleToggleGlobalShare = async (action: 'enable' | 'disable' | 'regenerate') => {
    if (!debt || shareUpdating) return;
    if (isCurrentUserIsolated && action !== 'disable') {
      alert('Your account is in security quarantine. Public link creation is restricted.');
      return;
    }
    if (debt.status === 'declined' && action !== 'disable') {
      alert('Cannot enable global public sharing on a declined agreement.');
      return;
    }

    setShareUpdating(true);
    try {
      const nowIso = new Date().toISOString();
      const newToken = action === 'disable' ? null : generateShareToken('gsh');
      const logAction =
        action === 'enable'
          ? 'global_share_enabled'
          : action === 'regenerate'
          ? 'global_share_regenerated'
          : 'global_share_disabled';

      const newLogEntry: ActivityLogEntry = {
        id: `temp-${Date.now()}`,
        user_id: currentUserId,
        debt_id: debt.id,
        action: logAction,
        details: {
          by_user_id: currentUserId,
          by_name: myName,
          timestamp: nowIso,
        },
        created_at: nowIso,
      };

      const updatedLogs = [newLogEntry, ...activityLogs];

      const newShareMeta: TransactionShareMetadata =
        action === 'disable'
          ? {
              globalEnabled: false,
              globalToken: null,
              enabledBy: shareMeta?.enabledBy || null,
              enabledByName: shareMeta?.enabledByName || null,
              enabledAt: shareMeta?.enabledAt || null,
              disabledBy: currentUserId,
              disabledByName: myName,
              disabledAt: nowIso,
              dismissedAlertBy: [],
            }
          : {
              globalEnabled: true,
              globalToken: newToken,
              enabledBy: currentUserId,
              enabledByName: myName,
              enabledAt: nowIso,
              disabledBy: null,
              disabledByName: null,
              disabledAt: null,
              dismissedAlertBy: [currentUserId],
              snapshot: {
                counterpartyNotes: null,
                dueDate: debt.due_date || null,
                settledAt: debt.settled_at || null,
                payments: payments.slice(0, 10).map((p: any) => ({
                  id: p.id,
                  amount: Number(p.amount) || 0,
                  currency: p.currency || debtCurrency,
                  created_at: p.created_at,
                  is_verified: p.is_verified,
                  verified_at: p.verified_at || null,
                  payment_method: p.payment_method || null,
                  transaction_ref: p.transaction_ref || null,
                  note: null,
                })),
                auditLog: updatedLogs.slice(0, 12).map((l: any) => ({
                  id: l.id,
                  action: l.action,
                  created_at: l.created_at,
                  details: l.details || {},
                })),
                updatedAt: nowIso,
              },
            };

      const encodedNotes = buildDebtNotesWithMetadata(debt, {
        shareMetadata: newShareMeta,
      });

      const { error: updErr } = await supabase
        .from('debts')
        .update({ notes: encodedNotes })
        .eq('id', debt.id);

      if (updErr) throw updErr;

      // Insert audit log entry so counterparty gets real-time notification and audit trail record
      await supabase.from('activity_log').insert({
        user_id: currentUserId,
        debt_id: debt.id,
        action: logAction,
        details: {
          by_user_id: currentUserId,
          by_name: myName,
          counterparty_id: otherPerson?.id || null,
          principal: debt.principal,
          currency: debtCurrency,
          timestamp: nowIso,
        },
      });

      // Notify counterparty via email when global sharing is enabled
      if (action === 'enable' && otherPerson?.email) {
        sendNotificationEmail({
          type: 'debt_recorded',
          recipientEmail: otherPerson.email,
          recipientName: otherName,
          senderName: myName,
          amount: debt.principal,
          currency: debtCurrency,
          notes: `${myName} enabled a Global Public Share Link for your transaction. You can view or turn off global sharing anytime from your DebtSync notifications or transaction details.`,
          debtId: debt.id,
        });
      }

      setInternalDebt({ ...debt, notes: encodedNotes });
      if (action !== 'disable' && newToken) {
        const freshUrl = `${getOrigin()}/share?id=${debt.id}&token=${newToken}`;
        handleCopyShareLink('global', freshUrl);
      }

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      await fetchDebtDetails();
      onDebtUpdated?.();
    } catch (err: any) {
      console.error('Failed to update share settings:', err);
      alert(err.message || 'Could not update sharing permissions.');
    } finally {
      setShareUpdating(false);
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

  const handleAcceptDebt = async (decision: 'active' | 'declined') => {
    if (!debt) return;
    setActionLoading(true);
    try {
      await respondToDebtAgreement(supabase, debt.id, decision);
      await fetchDebtDetails();
      onDebtUpdated?.();
    } catch (e: any) {
      console.error('Failed to update debt status:', e);
      alert(e.message || 'Failed to update agreement status.');
    } finally {
      setActionLoading(false);
    }
  };

  const sortedPayments = sortPaymentsPendingFirst(payments);

  const totalObligation = calc.principal + calc.totalAccruedInterest;
  const paidPct = totalObligation > 0 ? Math.min(100, Math.round((calc.totalPaid / totalObligation) * 100)) : 0;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Debt Agreement & Audit Trail"
        subtitle={`ID: ${debt.id.substring(0, 8)} • Recorded on ${new Date(debt.created_at).toLocaleDateString()}`}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-5">
          {/* Live Global Sharing Status Banner (minimal & subtle, always visible when active so either party can turn it off) */}
          {isGlobalShared && (
            <div className="p-3 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <span className="material-symbols-outlined text-[var(--on-surface-variant)] text-[16px] shrink-0 mt-0.5">
                  public
                </span>
                <div className="min-w-0">
                  <div className="font-mono text-xs font-bold text-[var(--on-surface)] flex items-center gap-1.5 flex-wrap">
                    <span>Public Link Active</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/25 text-[var(--on-surface-variant)]">
                      Read-Only
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-[var(--on-surface-variant)] mt-0.5 leading-relaxed">
                    Enabled by <strong>{shareMeta?.enabledBy === currentUserId ? 'You' : (shareMeta?.enabledByName || otherName)}</strong>
                    {shareMeta?.enabledAt ? ` on ${new Date(shareMeta.enabledAt).toLocaleDateString()}` : ''}. Notes and emails are hidden on the public link. Either party can turn this off anytime.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <button
                  type="button"
                  onClick={() => handleCopyShareLink('global')}
                  className="py-1.5 px-2.5 rounded-lg bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/40 text-[var(--on-surface)] font-mono text-[11px] font-bold hover:bg-[var(--surface-container-highest)] transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[13px]">
                    {copiedLinkType === 'global' ? 'check' : 'content_copy'}
                  </span>
                  <span>{copiedLinkType === 'global' ? 'Copied!' : 'Copy Link'}</span>
                </button>
                <button
                  type="button"
                  disabled={shareUpdating}
                  onClick={() => handleToggleGlobalShare('disable')}
                  className="py-1.5 px-2.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 font-mono text-[11px] font-bold hover:bg-red-500/20 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Immediately revoke public access to the global link"
                >
                  <span className="material-symbols-outlined text-[13px]">link_off</span>
                  <span>Turn Off</span>
                </button>
              </div>
            </div>
          )}

          {/* Header Card: Counterparty & Position */}
          <div className="p-4 rounded-2xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <Link
              href={`/directory/detail?id=${otherPerson?.id || debt.id}`}
              onClick={onClose}
              className="flex items-center gap-3 hover:opacity-90 group cursor-pointer"
              title={`View ${otherName}'s contact ledger`}
            >
              <Avatar src={otherPerson?.avatar_url} name={otherName} size="md" />
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-heading font-bold text-base text-[var(--on-surface)] group-hover:text-[var(--primary)] group-hover:underline transition-colors">
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
            </Link>

            <div className="flex items-center justify-between sm:justify-end gap-3">
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

              <button
                type="button"
                onClick={() => setIsShareDrawerOpen(!isShareDrawerOpen)}
                className={`p-2.5 rounded-xl border font-mono text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                  isShareDrawerOpen || isGlobalShared
                    ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)] shadow-xs'
                    : 'border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] hover:border-[var(--primary)]/50'
                }`}
                title="Share transaction link or manage visibility"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {isGlobalShared ? 'public' : 'share'}
                </span>
                <span className="hidden xs:inline">Share</span>
              </button>
            </div>
          </div>

          {/* Expandable Share & Visibility Control Panel */}
          {isShareDrawerOpen && (
            <div className="p-4 rounded-2xl bg-[var(--surface-container)] border border-[var(--primary)]/30 space-y-4 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="flex items-center justify-between border-b border-[var(--outline-variant)]/20 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">
                    shield_lock
                  </span>
                  <div>
                    <h4 className="font-heading font-bold text-xs sm:text-sm text-[var(--on-surface)]">
                      Share Transaction &amp; Link Privacy
                    </h4>
                    <p className="font-mono text-[11px] text-[var(--on-surface-variant)]">
                      Share privately with participating members or enable a public read-only link
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsShareDrawerOpen(false)}
                  className="p-1 rounded-lg text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* 1. Participants-Only Link Card */}
                <div className="p-3.5 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-[var(--on-surface)] flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">
                          lock
                        </span>
                        <span>Participants-Only Link</span>
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[var(--primary)]/10 text-[var(--primary)] border border-[var(--primary)]/20">
                        Default • Private
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-[var(--on-surface-variant)] mt-1.5 leading-relaxed">
                      {splitInfo
                        ? `Can ONLY be opened by you, ${otherName}, and the ${splitInfo.participants.length} participating members of "${splitInfo.title}" when signed in.`
                        : `Can ONLY be opened by you and ${otherName} when signed into your DebtSync accounts.`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopyShareLink('participant')}
                      className="flex-1 py-2 px-3 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-95 transition-opacity flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {copiedLinkType === 'participant' ? 'check' : 'content_copy'}
                      </span>
                      <span>
                        {copiedLinkType === 'participant' ? 'Copied Member Link!' : 'Copy Member Link'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNativeShare('participant')}
                      className="p-2 rounded-lg border border-[var(--outline-variant)]/40 text-[var(--on-surface)] hover:bg-[var(--surface-container)] transition-colors cursor-pointer"
                      title="Share via device share sheet"
                    >
                      <span className="material-symbols-outlined text-[16px]">ios_share</span>
                    </button>
                  </div>
                </div>

                {/* 2. Global Public Link Card */}
                <div
                  className={`p-3.5 rounded-xl border flex flex-col justify-between gap-3 ${
                    isGlobalShared
                      ? 'bg-emerald-500/5 border-emerald-500/30'
                      : 'bg-[var(--surface-container-lowest)] border-[var(--outline-variant)]/30'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-[var(--on-surface)] flex items-center gap-1.5">
                        <span
                          className={`material-symbols-outlined text-[16px] ${
                            isGlobalShared ? 'text-emerald-500' : 'text-[var(--on-surface-variant)]'
                          }`}
                        >
                          public
                        </span>
                        <span>Global Share Link</span>
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                          isGlobalShared
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                            : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] border-[var(--outline-variant)]/30'
                        }`}
                      >
                        {isGlobalShared ? 'Active • Public' : 'Off'}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-[var(--on-surface-variant)] mt-1.5 leading-relaxed">
                      {isGlobalShared
                        ? `Anyone with this secret token link can view a read-only summary. ${otherName} is notified and either of you can turn it off anytime.`
                        : `Create a separate public read-only link viewable by anyone. ${otherName} will receive a notification and can disable it anytime.`}
                    </p>
                  </div>

                  {isGlobalShared ? (
                    <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleCopyShareLink('global')}
                        className="flex-1 py-2 px-2.5 rounded-lg bg-emerald-600 text-white font-mono text-xs font-bold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1 cursor-pointer shadow-xs"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {copiedLinkType === 'global' ? 'check' : 'link'}
                        </span>
                        <span>{copiedLinkType === 'global' ? 'Copied Global Link!' : 'Copy Global Link'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={shareUpdating}
                        onClick={() => handleToggleGlobalShare('regenerate')}
                        className="p-2 rounded-lg border border-[var(--outline-variant)]/40 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container)] transition-colors cursor-pointer disabled:opacity-50"
                        title="Rotate link token (invalidates previously shared global links)"
                      >
                        <span className="material-symbols-outlined text-[15px]">refresh</span>
                      </button>
                      <button
                        type="button"
                        disabled={shareUpdating}
                        onClick={() => handleToggleGlobalShare('disable')}
                        className="py-2 px-2.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 font-mono text-xs font-bold hover:bg-red-500/20 transition-colors cursor-pointer disabled:opacity-50"
                        title="Turn off global sharing"
                      >
                        Off
                      </button>
                    </div>
                  ) : (
                    <div className="pt-1">
                      <button
                        type="button"
                        disabled={shareUpdating || debt.status === 'declined' || isCurrentUserIsolated}
                        onClick={() => handleToggleGlobalShare('enable')}
                        className="w-full py-2 px-3 rounded-lg border border-[var(--outline-variant)]/50 bg-[var(--surface-container)] hover:border-[var(--primary)]/50 hover:text-[var(--primary)] text-[var(--on-surface)] font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {shareUpdating ? 'sync' : 'add_link'}
                        </span>
                        <span>
                          {shareUpdating ? 'Enabling...' : 'Enable Global Sharing & Copy Link'}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

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

          {/* Repayment Progress Bar */}
          {debt.status !== 'declined' && totalObligation > 0 && (
            <div className="px-3.5 py-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/20 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono text-[var(--on-surface-variant)]">
                <span>Settlement Progress ({paidPct}% Paid)</span>
                <span>
                  Remaining:{' '}
                  <strong className="text-[var(--on-surface)]">
                    {formatCurrency(calc.currentBalance, debtCurrency, { showDecimals: true })}
                  </strong>
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[var(--surface-container-high)] overflow-hidden flex">
                <div
                  className="bg-emerald-500 h-full transition-all duration-300"
                  style={{ width: `${paidPct}%` }}
                />
              </div>
            </div>
          )}

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

          {/* Pending Agreement Action Banners */}
          {debt.status === 'pending' && debt.created_by === currentUserId && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-amber-500 text-[20px] mt-0.5 shrink-0">
                  pending_actions
                </span>
                <div>
                  <div className="font-heading font-bold text-xs text-amber-900 dark:text-amber-200">
                    Pending Counterparty Acceptance
                  </div>
                  <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                    Waiting for {otherName} to review &amp; accept this agreement. You can edit the principal, interest, terms, or notes before they accept.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(true)}
                className="py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-stone-950 font-mono text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 cursor-pointer shadow-xs transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">edit</span>
                <span>Edit Agreement</span>
              </button>
            </div>
          )}

          {debt.status === 'pending' && debt.created_by !== currentUserId && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-amber-500 text-[20px] mt-0.5 shrink-0">
                  notification_important
                </span>
                <div>
                  <div className="font-heading font-bold text-xs text-amber-900 dark:text-amber-200">
                    Action Required: Review Agreement
                  </div>
                  <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                    {otherName} proposed this transaction. Please review the principal amount and terms before accepting.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleAcceptDebt('active')}
                  disabled={actionLoading}
                  className="py-1.5 px-3 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer shadow-xs flex items-center gap-1 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[14px]">check_circle</span>
                  <span>Accept</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Decline this agreement?')) handleAcceptDebt('declined');
                  }}
                  disabled={actionLoading}
                  className="py-1.5 px-3 rounded-lg border border-red-500/30 text-red-500 font-mono text-xs font-bold hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span>Decline</span>
                </button>
              </div>
            </div>
          )}

          {/* Split Bill Group Card */}
          {(() => {
            const split = parseSplitDetails(debt);
            if (!split) return null;

            return (
              <div className="p-4 rounded-xl border border-[var(--primary)]/30 bg-gradient-to-br from-[var(--primary)]/10 via-[var(--surface-container-low)] to-[var(--surface-container)] space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[20px] text-[var(--primary)]">call_split</span>
                    <div>
                      <span className="font-heading text-sm font-bold text-[var(--on-surface)] block">
                        Split Bill: {split.title}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--on-surface-variant)]">
                        Original Total: {formatCurrency(split.totalAmount, split.currency)} • Organized by {split.payerName}
                        {((split.interestType && split.interestType !== 'none' && split.interestRate) || (debt.interest_type && debt.interest_type !== 'none' && debt.interest_rate)) && (
                          <span className="ml-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                            • {split.interestRate || debt.interest_rate}% {split.interestType || debt.interest_type} APR
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {((split.interestType && split.interestType !== 'none' && split.interestRate) || (debt.interest_type && debt.interest_type !== 'none' && debt.interest_rate)) && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                        {split.interestRate || debt.interest_rate}% APR
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[var(--primary)]/20 text-[var(--primary)] border border-[var(--primary)]/30">
                      {split.participants.length} People
                    </span>
                  </div>
                </div>

                {/* Participant breakdown list */}
                <div className="space-y-1.5 pt-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold block">
                    Group Split Breakdown
                  </span>
                  <div className="max-h-40 overflow-y-auto overscroll-contain modal-scroll-container pr-1 space-y-1.5">
                    {split.participants.map((pt) => {
                      const isMe = pt.userId === currentUserId;
                      return (
                        <div
                          key={pt.userId}
                          className={`p-2 rounded-lg flex items-center justify-between text-xs border ${
                            isMe
                              ? 'bg-[var(--primary)]/15 border-[var(--primary)]/30 font-bold'
                              : 'bg-[var(--surface-container-lowest)]/80 border-[var(--outline-variant)]/20'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate text-[var(--on-surface)]">
                              {pt.name} {isMe ? '(You)' : ''}
                            </span>
                            {pt.isPayer && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                Paid Bill
                              </span>
                            )}
                          </div>
                          <span className="font-mono font-bold text-[var(--on-surface)] shrink-0 ml-2">
                            {formatCurrency(pt.shareAmount, split.currency)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Two-Sided Notes Section */}
          {(() => {
            const cleanNotes = getCleanDebtNotes(debt.notes).trim();
            const counterNote = debt.counterparty_notes?.trim();

            return (
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

                {cleanNotes || counterNote ? (
                  <div className="space-y-2 text-xs">
                    {cleanNotes && (
                      <div className="flex items-start gap-2 text-[var(--on-surface-variant)] bg-[var(--surface-container-low)] p-2.5 rounded-lg border border-[var(--outline-variant)]/20">
                        <span className="material-symbols-outlined text-[16px] text-[var(--primary)] shrink-0 mt-0.5">
                          edit_note
                        </span>
                        <div>
                          <strong className="text-[var(--on-surface)] block mb-0.5">Creator Note:</strong>
                          <span>{cleanNotes}</span>
                        </div>
                      </div>
                    )}
                    {counterNote && (
                      <div className="flex items-start gap-2 text-[var(--on-surface-variant)] bg-[var(--surface-container-low)] p-2.5 rounded-lg border border-[var(--outline-variant)]/20">
                        <span className="material-symbols-outlined text-[16px] text-[var(--secondary)] shrink-0 mt-0.5">
                          quick_reference_all
                        </span>
                        <div>
                          <strong className="text-[var(--on-surface)] block mb-0.5">Counterparty Note:</strong>
                          <span>{counterNote}</span>
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
            );
          })()}

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

            {sortedPayments.length === 0 ? (
              <div className="p-4 rounded-xl border border-[var(--outline-variant)]/20 text-center font-mono text-xs text-[var(--on-surface-variant)]">
                No payments or repayments recorded yet for this agreement.
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto overscroll-contain modal-scroll-container pr-1 space-y-2.5">
                {sortedPayments.map((p) => {
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
              <div className="max-h-56 overflow-y-auto overscroll-contain modal-scroll-container pr-2">
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
                    } else if (log.action === 'debt_pending_edited') {
                      dotColor = 'bg-amber-500';
                      title = `Pending Agreement Edited (Principal: ${formatCurrency(Number((log.details as any)?.newPrincipal || debt.principal), debtCurrency)})`;
                    } else if (log.action === 'debt_accepted') {
                      dotColor = 'bg-emerald-500';
                      title = 'Agreement Accepted by Counterparty';
                    } else if (log.action === 'debt_declined') {
                      dotColor = 'bg-red-500';
                      title = 'Agreement Declined by Counterparty';
                    } else if (log.action === 'debt_settled') {
                      dotColor = 'bg-emerald-500';
                      title = 'Debt Agreement Fully Settled';
                    } else if (log.action === 'global_share_enabled') {
                      dotColor = 'bg-amber-500';
                      title = `Global Public Link Enabled by ${(log.details as any)?.actorName || 'Participant'}`;
                    } else if (log.action === 'global_share_disabled') {
                      dotColor = 'bg-[var(--outline)]';
                      title = `Global Public Link Disabled by ${(log.details as any)?.actorName || 'Participant'}`;
                    } else if (log.action === 'global_share_regenerated') {
                      dotColor = 'bg-amber-500';
                      title = `Global Public Link Rotated by ${(log.details as any)?.actorName || 'Participant'}`;
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
              </div>
            )}
          </div>

          {/* Modal Footer Actions */}
          <div className="pt-4 border-t border-[var(--outline-variant)]/20 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {debt.status === 'active' && calc.currentBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(true)}
                  className="py-2 px-3.5 rounded-xl bg-[var(--secondary)] text-[var(--on-secondary)] font-mono text-xs font-bold hover:opacity-95 shadow-xs cursor-pointer min-h-[40px]"
                >
                  {isLender ? 'Record Payment' : 'Report Repayment'}
                </button>
              )}

              {debt.status === 'pending' && debt.created_by === currentUserId && (
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(true)}
                  className="py-2 px-3.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-95 shadow-xs flex items-center gap-1.5 cursor-pointer min-h-[40px]"
                >
                  <span className="material-symbols-outlined text-[15px]">edit</span>
                  <span>Edit Agreement</span>
                </button>
              )}

              {debt.status === 'pending' && debt.created_by !== currentUserId && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAcceptDebt('active')}
                    disabled={actionLoading}
                    className="py-2 px-3.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 shadow-xs flex items-center gap-1 cursor-pointer disabled:opacity-50 min-h-[40px]"
                  >
                    <span className="material-symbols-outlined text-[15px]">check_circle</span>
                    <span>Accept</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Decline this agreement?')) handleAcceptDebt('declined');
                    }}
                    disabled={actionLoading}
                    className="py-2 px-3 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 font-mono text-xs font-bold cursor-pointer disabled:opacity-50 min-h-[40px]"
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="py-2 px-4 rounded-xl border border-[var(--outline-variant)]/40 font-mono text-xs font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container)] cursor-pointer min-h-[40px]"
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

      {/* Edit Pending Debt Modal */}
      {isEditModalOpen && (
        <EditPendingDebtModal
          isOpen={isEditModalOpen}
          debt={debt}
          onClose={() => setIsEditModalOpen(false)}
          onDebtUpdated={() => {
            fetchDebtDetails();
            onDebtUpdated?.();
          }}
        />
      )}
    </>
  );
}
