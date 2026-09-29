'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Debt, PaymentMethod } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';
import { round2 } from '@/lib/utils/interest';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { sendNotificationEmail } from '@/lib/utils/email-notifier';
import { generateUPILink, generateUPIQRCodeDataURL, PAYMENT_METHOD_LABELS } from '@/lib/utils/upi-link';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  debt: Debt;
  currentBalance: number;
  onPaymentRecorded?: () => void;
}

export function PaymentModal({
  isOpen,
  onClose,
  debt,
  currentBalance,
  onPaymentRecorded,
}: PaymentModalProps) {
  const initialDefault = round2(Math.min(currentBalance, 500));
  const [amountStr, setAmountStr] = useState<string>(() => (initialDefault > 0 ? String(initialDefault) : ''));
  const [amount, setAmount] = useState<number>(initialDefault);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi');
  const [transactionRef, setTransactionRef] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingLimits, setCheckingLimits] = useState(false);
  const [error, setError] = useState('');
  const [isLender, setIsLender] = useState(false);
  const [pendingAmount, setPendingAmount] = useState(0);
  const [lenderProfile, setLenderProfile] = useState<{ id: string; full_name?: string; email?: string; upi_id?: string | null } | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [showQrCode, setShowQrCode] = useState(false);
  const [generatingQr, setGeneratingQr] = useState(false);

  const supabase = createClient();

  const handleAmountChange = (val: string) => {
    const sanitized = val.replace(/^0+(?=\d)/, '');
    setAmountStr(sanitized);
    setAmount(parseFloat(sanitized) || 0);
  };

  const setAmountUnified = (val: number) => {
    setAmount(val);
    setAmountStr(val > 0 ? String(val) : '');
  };

  // Generate UPI deeplink whenever amount or lender UPI changes
  const upiLink = lenderProfile?.upi_id
    ? generateUPILink(
        lenderProfile.upi_id,
        lenderProfile.full_name || 'Lender',
        amount > 0 ? amount : undefined,
        debt.currency || 'INR',
        `Repayment for Debt #${debt.id.slice(0, 6)}`
      )
    : '';

  useEffect(() => {
    if (!upiLink || !showQrCode) return;
    let isMounted = true;
    setGeneratingQr(true);
    generateUPIQRCodeDataURL(upiLink, 220)
      .then((url) => {
        if (isMounted) setQrCodeDataUrl(url);
      })
      .finally(() => {
        if (isMounted) setGeneratingQr(false);
      });
    return () => {
      isMounted = false;
    };
  }, [upiLink, showQrCode]);

  useEffect(() => {
    if (!isOpen) return;

    async function loadRoleAndLimits() {
      setCheckingLimits(true);
      setError('');
      try {
        const user = await getCurrentUserFast(supabase);
        if (!user) return;

        const userIsLender = user.id === debt.lender_id;
        setIsLender(userIsLender);

        if (!userIsLender) {
          // Fetch lender profile to check for UPI ID and display name
          const { data: lenderData } = await supabase
            .from('profiles')
            .select('id, full_name, email, upi_id')
            .eq('id', debt.lender_id)
            .single();
          if (lenderData) setLenderProfile(lenderData);

          // Calculate existing pending unverified payments for this debt
          const { data: debtPayments } = await supabase
            .from('payments')
            .select('*')
            .eq('debt_id', debt.id)
            .eq('is_verified', false);

          const isDisputed = (p: any) =>
            p.status === 'disputed' ||
            (p.is_verified === false && p.verified_at != null) ||
            (typeof p.note === 'string' && p.note.includes('[DISPUTED]'));

          const activePending = (debtPayments || []).filter((p: any) => !isDisputed(p));
          const totalPending = round2(
            activePending.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)
          );
          setPendingAmount(totalPending);

          const allowable = Math.max(0, round2(currentBalance - totalPending));
          setAmountUnified(round2(Math.min(allowable, 500)));
        } else {
          setPendingAmount(0);
          setAmountUnified(round2(Math.min(currentBalance, 500)));
        }
      } catch (err) {
        console.error('Error loading payment limits:', err);
      } finally {
        setCheckingLimits(false);
      }
    }

    loadRoleAndLimits();
  }, [isOpen, debt.id, debt.lender_id, currentBalance, supabase]);

  const maxAllowable = isLender
    ? round2(currentBalance)
    : Math.max(0, round2(currentBalance - pendingAmount));
  const isBlockedByPending = !isLender && maxAllowable <= 0.009;

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) throw new Error('User not logged in');

      const rawNum = Number(amount);
      if (isNaN(rawNum) || rawNum <= 0) throw new Error('Payment amount must be greater than 0');
      const paymentAmount = round2(rawNum);

      const userIsLender = user.id === debt.lender_id;
      const isVerified = userIsLender;

      // Cap validation for borrower: Cannot request more than remaining balance minus pending unverified requests
      if (!userIsLender) {
        if (paymentAmount > maxAllowable + 0.005) {
          throw new Error(
            `Payment request of ${formatCurrency(paymentAmount, debt.currency || 'inr', { showDecimals: true })} exceeds allowable limit (${formatCurrency(maxAllowable, debt.currency || 'inr', { showDecimals: true })}). An existing request of ${formatCurrency(pendingAmount, debt.currency || 'inr', { showDecimals: true })} is already awaiting verification.`
          );
        }
      }

      // Digital payment verification check: Non-cash payments require a transaction ID / reference
      if (paymentMethod !== 'cash' && !transactionRef.trim()) {
        throw new Error('Please enter the transaction reference / UTR ID for verification.');
      }

      // Record payment
      const paymentPayload: any = {
        debt_id: debt.id,
        paid_by: user.id,
        amount: paymentAmount,
        currency: debt.currency || 'inr',
        note: note.trim() || (isVerified ? 'Settlement payment' : 'Repayment reported'),
        payment_method: paymentMethod,
        transaction_ref: paymentMethod === 'cash' ? null : transactionRef.trim(),
        is_verified: isVerified,
        verified_at: isVerified ? new Date().toISOString() : null,
        verified_by: isVerified ? user.id : null,
      };

      let { error: paymentError } = await supabase.from('payments').insert(paymentPayload);
      if (
        paymentError &&
        (paymentError.message?.includes('payment_method') || paymentError.message?.includes('transaction_ref'))
      ) {
        delete paymentPayload.payment_method;
        delete paymentPayload.transaction_ref;
        const retryRes = await supabase.from('payments').insert(paymentPayload);
        paymentError = retryRes.error;
      }

      if (paymentError) throw paymentError;

      // If lender recorded payment and it clears the balance (within 0.005 threshold), settle immediately and purge orphaned unverified payments
      if (isVerified && paymentAmount >= currentBalance - 0.005) {
        await supabase
          .from('debts')
          .update({
            status: 'settled',
            settled_at: new Date().toISOString(),
          })
          .eq('id', debt.id);

        // Auto-purge any lingering unverified payments for this settled debt
        await supabase
          .from('payments')
          .delete()
          .eq('debt_id', debt.id)
          .eq('is_verified', false);
      }

      // Add activity log
      await supabase.from('activity_log').insert({
        user_id: user.id,
        debt_id: debt.id,
        action: isVerified ? 'payment_made' : 'repayment_reported',
        details: {
          amount: paymentAmount,
          currency: debt.currency || 'inr',
          note: note.trim(),
          payment_method: paymentMethod,
          transaction_ref: paymentMethod === 'cash' ? null : transactionRef.trim(),
          is_verified: isVerified,
          remaining: isVerified ? Math.max(0, round2(currentBalance - paymentAmount)) : round2(currentBalance),
        },
      });

      // Dispatch email notification to lender when borrower reports a repayment
      if (!userIsLender) {
        (async () => {
          try {
            const { data: lenderData } = await supabase
              .from('profiles')
              .select('email, full_name')
              .eq('id', debt.lender_id)
              .single();

            if (lenderData?.email && !lenderData.email.endsWith('@phone.debtsync.local')) {
              const methodLabel = PAYMENT_METHOD_LABELS[paymentMethod]?.label || paymentMethod.toUpperCase();
              const fullNotes = [
                note.trim(),
                transactionRef.trim() ? `[${methodLabel}] Ref/UTR: ${transactionRef.trim()}` : null,
              ]
                .filter(Boolean)
                .join(' | ');

              sendNotificationEmail({
                type: 'payment_request',
                recipientEmail: lenderData.email,
                recipientName: lenderData.full_name,
                senderName: user.user_metadata?.full_name || user.email || 'The borrower',
                amount: paymentAmount,
                currency: debt.currency || 'inr',
                notes: fullNotes || undefined,
                debtId: debt.id,
              });
            }
          } catch (notifErr) {
            console.error('Failed to dispatch payment notification email:', notifErr);
          }
        })();
      }

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      onPaymentRecorded?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  const paymentMethodsList: PaymentMethod[] = [
    'upi',
    'gpay',
    'phonepe',
    'paytm',
    'bank_transfer',
    'cash',
    'other',
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isLender ? 'Record Received Payment' : 'Report Repayment'}
      subtitle={`Remaining outstanding balance: ${formatCurrency(round2(currentBalance), debt.currency || 'inr', { showDecimals: true })}`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handlePayment} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-[var(--error)] text-sm border border-[var(--error)]/20">
            {error}
          </div>
        )}

        {/* UPI Direct Pay & QR Card for Borrower */}
        {!isLender && lenderProfile?.upi_id && (
          <div className="p-3.5 rounded-2xl bg-gradient-to-br from-[var(--primary)]/10 via-[var(--surface-container)] to-[var(--surface-container-high)] border border-[var(--primary)]/25 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-[var(--primary)]">qr_code_2</span>
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--on-surface)]">
                  Direct UPI Pay
                </span>
              </div>
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-[var(--primary)]/15 text-[var(--primary)]">
                Instant Transfer
              </span>
            </div>

            <div className="flex items-center justify-between text-xs font-mono bg-[var(--surface-container-lowest)] p-2 rounded-xl border border-[var(--outline-variant)]/20">
              <span className="text-[var(--on-surface-variant)] truncate">Payee: {lenderProfile.upi_id}</span>
              <button
                type="button"
                onClick={() => {
                  if (lenderProfile?.upi_id) {
                    navigator.clipboard.writeText(lenderProfile.upi_id);
                  }
                }}
                className="text-[var(--primary)] hover:underline shrink-0 ml-2 font-bold flex items-center gap-1"
                title="Copy UPI ID"
              >
                <span className="material-symbols-outlined text-[14px]">content_copy</span>
                <span>Copy</span>
              </button>
            </div>

            {/* UPI Deeplink CTA & QR Toggle */}
            <div className="flex gap-2 pt-1">
              <a
                href={upiLink}
                className="flex-1 py-2 px-3 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold text-center flex items-center justify-center gap-1.5 hover:brightness-110 active:scale-[0.98] transition-all shadow-xs"
              >
                <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                <span>Pay in UPI App</span>
              </a>

              <button
                type="button"
                onClick={() => setShowQrCode(!showQrCode)}
                className="py-2 px-3 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-xs font-semibold flex items-center gap-1.5 hover:bg-[var(--surface-container)] transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">qr_code</span>
                <span>{showQrCode ? 'Hide QR' : 'Show QR'}</span>
              </button>
            </div>

            {/* Generated QR Code View */}
            {showQrCode && (
              <div className="p-3 bg-white rounded-xl text-center space-y-2 mt-2 shadow-sm border border-black/5 animate-in fade-in zoom-in-95 duration-150">
                {generatingQr ? (
                  <div className="w-48 h-48 flex items-center justify-center mx-auto text-neutral-500 font-mono text-xs">
                    Generating QR...
                  </div>
                ) : qrCodeDataUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrCodeDataUrl}
                      alt="UPI Payment QR Code"
                      className="w-48 h-48 mx-auto rounded-lg"
                    />
                    <p className="text-[11px] font-mono text-neutral-600">
                      Scan with any UPI app (GPay, PhonePe, Paytm, BHIM)
                    </p>
                  </>
                ) : null}
              </div>
            )}

            <p className="text-[10px] font-mono text-[var(--on-surface-variant)] leading-relaxed">
              💡 After completing payment in your UPI app, copy the 12-digit UPI Ref/UTR number and paste it below.
            </p>
          </div>
        )}

        {!isLender && pendingAmount > 0 && isBlockedByPending && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
            <span className="material-symbols-outlined text-[20px] text-amber-500 shrink-0 mt-0.5">
              pending_actions
            </span>
            <div>
              <strong className="block font-semibold mb-0.5">Verification Pending Review:</strong>
              Repayment request(s) totaling{' '}
              <span className="font-mono font-bold">
                {formatCurrency(pendingAmount, debt.currency || 'inr', { showDecimals: true })}
              </span>{' '}
              are already awaiting confirmation from the lender. You cannot submit additional requests until the lender reviews or disputes the pending receipt.
            </div>
          </div>
        )}

        {!isLender && pendingAmount > 0 && !isBlockedByPending && (
          <div className="p-3 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/20 text-xs text-[var(--on-surface)] flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] text-[var(--primary)] shrink-0 mt-0.5">
              info
            </span>
            <div>
              <span className="font-mono font-semibold">
                {formatCurrency(pendingAmount, debt.currency || 'inr', { showDecimals: true })}
              </span>{' '}
              is currently awaiting lender verification. Maximum additional payment request allowed:{' '}
              <span className="font-mono font-bold text-[var(--primary)]">
                {formatCurrency(maxAllowable, debt.currency || 'inr', { showDecimals: true })}
              </span>.
            </div>
          </div>
        )}

        {!isLender && pendingAmount === 0 && (
          <div className="p-3 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/20 text-xs text-[var(--on-surface)] flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] text-[var(--primary)] shrink-0 mt-0.5">
              verified_user
            </span>
            <span>
              Repayments reported by borrowers require lender confirmation in their notification center before the ledger balance is settled.
            </span>
          </div>
        )}

        {/* Amount Input */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)]">
              Payment Amount
            </label>
            {maxAllowable > 0 && (
              <button
                type="button"
                onClick={() => setAmountUnified(round2(maxAllowable))}
                className="font-mono text-xs text-[var(--primary)] font-bold hover:underline"
              >
                Pay Full ({formatCurrency(round2(maxAllowable), debt.currency || 'inr', { showDecimals: true })})
              </button>
            )}
          </div>
          <input
            type="number"
            min="0.01"
            max={maxAllowable > 0 ? maxAllowable : undefined}
            step="0.01"
            required
            disabled={isBlockedByPending || loading || checkingLimits}
            value={amountStr}
            placeholder="0.00"
            onChange={(e) => handleAmountChange(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-lg font-bold outline-none focus:border-[var(--primary)] disabled:opacity-50 disabled:bg-[var(--surface-container-low)]"
          />
        </div>

        {/* Payment Method Selector */}
        <div>
          <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
            Payment Mode
          </label>
          <div className="flex flex-wrap gap-1.5">
            {paymentMethodsList.map((m) => {
              const meta = PAYMENT_METHOD_LABELS[m];
              const isSelected = paymentMethod === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`px-3 py-1.5 rounded-xl font-mono text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                      : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">{meta?.icon || 'payment'}</span>
                  <span>{meta?.label || m}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Transaction Reference ID Input (Compulsory for non-cash) */}
        {paymentMethod !== 'cash' ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] flex items-center gap-1 font-bold">
                <span>Transaction Ref / UTR ID</span>
                <span className="text-[var(--error)]">*</span>
              </label>
              <span className="font-mono text-[10px] text-[var(--primary)] uppercase font-semibold">
                Required
              </span>
            </div>
            <input
              type="text"
              required
              disabled={isBlockedByPending || loading || checkingLimits}
              value={transactionRef}
              onChange={(e) => setTransactionRef(e.target.value)}
              placeholder={
                PAYMENT_METHOD_LABELS[paymentMethod]?.placeholder || 'Enter 12-digit UTR or transaction ID'
              }
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30"
            />
            <p className="text-[11px] font-mono text-[var(--on-surface-variant)] mt-1">
              {isLender
                ? 'Reference ID recorded for cross-verification in bank/app records.'
                : 'The other party will verify this reference in their banking/UPI app before confirming.'}
            </p>
          </div>
        ) : (
          <div className="p-2.5 rounded-xl bg-[var(--surface-container)] text-xs font-mono text-[var(--on-surface-variant)] flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-amber-500">payments</span>
            <span>Cash payments do not require digital reference ID.</span>
          </div>
        )}

        {/* Note / Remarks */}
        <div>
          <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
            Note / Remarks <span className="normal-case text-[var(--outline)] text-[11px]">(optional)</span>
          </label>
          <input
            type="text"
            disabled={isBlockedByPending || loading || checkingLimits}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Settle grocery bill, Final installment"
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)] disabled:opacity-50"
          />
        </div>

        <div className="pt-4 border-t border-[var(--outline-variant)]/20 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl border border-[var(--outline-variant)]/40 font-mono text-xs font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || checkingLimits || isBlockedByPending}
            className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--secondary)] text-[var(--on-secondary)] font-mono text-xs font-bold hover:opacity-95 disabled:opacity-50"
          >
            {loading
              ? 'Submitting...'
              : checkingLimits
              ? 'Checking...'
              : isLender
              ? 'Record Payment'
              : isBlockedByPending
              ? 'Verification Pending'
              : 'Submit for Verification'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
