'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Debt, PaymentMethod } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';
import { round2 } from '@/lib/utils/interest';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { sendNotificationEmail } from '@/lib/utils/email-notifier';
import {
  generateUPILink,
  generateUPIQRCodeDataURL,
  PAYMENT_METHOD_LABELS,
  detectUPIApp,
  PRIMARY_PAYMENT_METHODS,
  UPI_SUB_APPS,
  isUPIMethod,
  UPI_POPULAR_APPS,
  launchUPIApp,
  getUPIAppLaunchUrl,
  getSortedUPIAppsForUser,
  maskBankAccount,
  isValidIFSC,
} from '@/lib/utils/upi-link';

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
  const [amountStr, setAmountStr] = useState<string>(() => (initialDefault > 0 ? initialDefault.toFixed(2) : ''));
  const [amount, setAmount] = useState<number>(initialDefault);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi');
  const [transactionRef, setTransactionRef] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingLimits, setCheckingLimits] = useState(false);
  const [error, setError] = useState('');
  const [isLender, setIsLender] = useState(false);
  const [pendingAmount, setPendingAmount] = useState(0);
  const [lenderProfile, setLenderProfile] = useState<{
    id: string;
    full_name?: string;
    email?: string;
    upi_id?: string | null;
    preferred_repayment_method?: 'upi' | 'bank_transfer' | null;
    bank_name?: string | null;
    bank_account_number?: string | null;
    bank_ifsc?: string | null;
    bank_account_holder_name?: string | null;
  } | null>(null);
  const [repaymentChannel, setRepaymentChannel] = useState<'upi' | 'bank'>('upi');
  const [showMaskedAccount, setShowMaskedAccount] = useState(false);
  const [currentUserUpiId, setCurrentUserUpiId] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [upiPayTab, setUpiPayTab] = useState<'qr' | 'app'>('qr');
  const [prefillAmount, setPrefillAmount] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [showBankExplainer, setShowBankExplainer] = useState(false);
  const [selectedUpiApp, setSelectedUpiApp] = useState<string>('auto');
  const [generatingQr, setGeneratingQr] = useState(false);
  const [isCurrentUserIsolated, setIsCurrentUserIsolated] = useState(false);

  const supabase = React.useMemo(() => createClient(), []);
  const detectedLenderApp = detectUPIApp(lenderProfile?.upi_id);

  // Automatically sort UPI apps so that the paying user's own profile app appears 1st on top
  const { sortedApps, userPreferredApp } = React.useMemo(
    () => getSortedUPIAppsForUser(currentUserUpiId),
    [currentUserUpiId]
  );

  const hasUpi = Boolean(lenderProfile?.upi_id?.trim());
  const hasBank = Boolean(
    lenderProfile?.bank_account_number?.trim() ||
    lenderProfile?.bank_ifsc?.trim()
  );
  const hasBothMethods = hasUpi && hasBank;

  const handleAmountChange = (val: string) => {
    let sanitized = val.replace(/^0+(?=\d)/, '');
    const parts = sanitized.split('.');
    if (parts.length > 2) {
      sanitized = parts[0] + '.' + parts.slice(1).join('');
    }
    if (parts.length === 2 && parts[1].length > 2) {
      sanitized = parts[0] + '.' + parts[1].slice(0, 2);
    }
    setAmountStr(sanitized);
    setAmount(parseFloat(sanitized) || 0);
  };

  const handleAmountBlur = () => {
    const parsed = parseFloat(amountStr);
    if (!isNaN(parsed) && parsed > 0) {
      const formatted = round2(parsed);
      setAmount(formatted);
      setAmountStr(formatted.toFixed(2));
    }
  };

  const setAmountUnified = (val: number) => {
    const formatted = round2(val);
    setAmount(formatted);
    setAmountStr(formatted > 0 ? formatted.toFixed(2) : '');
  };

  const copyToClipboard = async (text: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2500);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleLaunchApp = (
    e: React.MouseEvent<HTMLAnchorElement>,
    appId: string,
    appName: string
  ) => {
    if (!lenderProfile?.upi_id) return;
    copyToClipboard(lenderProfile.upi_id, 'vpa');

    const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '').toLowerCase() : '';
    const isMobile = /android|iphone|ipad|ipod/i.test(ua);

    if (!isMobile) {
      e.preventDefault();
      setLaunchStatus(
        `Copied UPI ID (${lenderProfile.upi_id})! On desktop, scan the QR code above or paste into your mobile UPI app.`
      );
      setTimeout(() => {
        setLaunchStatus(null);
      }, 7000);
      return;
    }

    // On mobile: allow native <a> navigation to invoke OS intent or app scheme
    setLaunchStatus(`Copied UPI ID (${lenderProfile.upi_id})! Opening ${appName}... In ${appName}, verify the payee and complete payment.`);
    setTimeout(() => {
      setLaunchStatus(null);
    }, 7000);
  };

  const handleDownloadQR = () => {
    if (!qrCodeDataUrl) return;
    const cleanPayee = (lenderProfile?.full_name || 'debtsync-payee')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-');
    const a = document.createElement('a');
    a.href = qrCodeDataUrl;
    a.download = `debtsync-upi-qr-${cleanPayee}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setCopiedField('qr-download');
    setTimeout(() => setCopiedField(null), 2500);
  };

  const handleShareOrSaveQR = async () => {
    if (!qrCodeDataUrl) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
        const res = await fetch(qrCodeDataUrl);
        const blob = await res.blob();
        const file = new File([blob], 'debtsync-upi-qr.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `Pay ${lenderProfile?.full_name || 'Counterparty'}`,
            text: `DebtSync UPI payment of ${formatCurrency(amount || currentBalance, debt.currency || 'inr')} to ${lenderProfile?.upi_id}`,
            files: [file],
          });
          return;
        }
      }
    } catch {
      // fallback to download
    }
    handleDownloadQR();
  };

  // Generate standard NPCI compliant UPI deeplinks
  const upiLink = lenderProfile?.upi_id
    ? generateUPILink(
        lenderProfile.upi_id,
        lenderProfile.full_name || 'Lender',
        amount > 0 ? amount : undefined,
        debt.currency || 'INR',
        `DebtSync Repayment ${debt.id.slice(0, 6)}`
      )
    : '';

  const upiLinkWithoutAmount = lenderProfile?.upi_id
    ? generateUPILink(
        lenderProfile.upi_id,
        lenderProfile.full_name || 'Lender',
        undefined,
        debt.currency || 'INR',
        `DebtSync Repayment ${debt.id.slice(0, 6)}`
      )
    : '';

  const activeUpiLink = (prefillAmount && amount > 0) ? upiLink : upiLinkWithoutAmount;

  // Auto-generate QR code immediately whenever upiLink is available
  useEffect(() => {
    if (!upiLink) {
      setQrCodeDataUrl('');
      return;
    }
    let isMounted = true;
    setGeneratingQr(true);
    generateUPIQRCodeDataURL(upiLink, 240)
      .then((url) => {
        if (isMounted) setQrCodeDataUrl(url);
      })
      .finally(() => {
        if (isMounted) setGeneratingQr(false);
      });
    return () => {
      isMounted = false;
    };
  }, [upiLink]);

  const prevIsOpenRef = React.useRef(false);
  const prevDebtIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      return;
    }

    const isJustOpening = !prevIsOpenRef.current;
    const isDifferentDebt = prevDebtIdRef.current !== debt.id;

    async function loadRoleAndLimits() {
      setCheckingLimits(true);
      setError('');
      try {
        const user = await getCurrentUserFast(supabase);
        if (!user) return;

        const { data: myProf } = await supabase.from('profiles').select('is_isolated, upi_id').eq('id', user.id).single();
        setIsCurrentUserIsolated(Boolean(myProf?.is_isolated));
        if (myProf?.upi_id) {
          setCurrentUserUpiId(myProf.upi_id);
        }

        const userIsLender = user.id === debt.lender_id;
        setIsLender(userIsLender);

        if (!userIsLender) {
          // Fetch lender profile to check for repayment method, UPI ID, and bank details
          let lender: any = null;
          const { data: lenderData, error: lErr } = await supabase
            .from('profiles')
            .select('id, full_name, email, upi_id, preferred_repayment_method, bank_name, bank_account_number, bank_ifsc, bank_account_holder_name')
            .eq('id', debt.lender_id)
            .single();

          if (!lErr && lenderData) {
            lender = lenderData;
          } else {
            const { data: fallbackLender } = await supabase
              .from('profiles')
              .select('id, full_name, email, upi_id')
              .eq('id', debt.lender_id)
              .single();
            lender = fallbackLender;
          }

          if (lender) {
            setLenderProfile(lender);

            const hasLenderUpi = Boolean(lender.upi_id?.trim());
            const hasLenderBank = Boolean(
              lender.bank_account_number?.trim() ||
              lender.bank_ifsc?.trim()
            );
            const prefMethod = lender.preferred_repayment_method || 'upi';

            if (prefMethod === 'bank_transfer' && hasLenderBank) {
              setRepaymentChannel('bank');
              setPaymentMethod('bank_transfer');
            } else if (hasLenderUpi) {
              setRepaymentChannel('upi');
              setPaymentMethod('upi');
            } else if (hasLenderBank) {
              setRepaymentChannel('bank');
              setPaymentMethod('bank_transfer');
            } else {
              setRepaymentChannel('upi');
              setPaymentMethod('cash');
            }
          }

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

          if (isJustOpening || isDifferentDebt) {
            const allowable = Math.max(0, round2(currentBalance - totalPending));
            setAmountUnified(round2(Math.min(allowable, 500)));
          }
        } else {
          setPendingAmount(0);
          if (isJustOpening || isDifferentDebt) {
            setAmountUnified(round2(Math.min(currentBalance, 500)));
          }
        }
      } catch (err) {
        console.error('Error loading payment limits:', err);
      } finally {
        setCheckingLimits(false);
      }
    }

    if (isJustOpening || isDifferentDebt) {
      loadRoleAndLimits();
      prevDebtIdRef.current = debt.id;
    }

    prevIsOpenRef.current = true;
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

      if (isCurrentUserIsolated) {
        throw new Error('Your account is quarantined in security isolation. Submitting payments is disabled.');
      }

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

      const cleanRef = transactionRef.trim().replace(/[^\w\s-]/g, '').slice(0, 64);
      const cleanNote = note.trim().slice(0, 200);

      // Digital payment verification check: Non-cash payments require a transaction ID / reference
      if (paymentMethod !== 'cash' && !cleanRef) {
        throw new Error(
          paymentMethod === 'bank_transfer'
            ? 'Please enter the NEFT / IMPS / RTGS reference or UTR number for verification.'
            : 'Please enter the UPI transaction reference / UTR ID for verification.'
        );
      }

      // Record payment
      const paymentPayload: any = {
        debt_id: debt.id,
        paid_by: user.id,
        amount: paymentAmount,
        currency: debt.currency || 'inr',
        note: cleanNote || (isVerified ? 'Settlement payment' : 'Repayment reported'),
        payment_method: paymentMethod,
        transaction_ref: paymentMethod === 'cash' ? null : cleanRef,
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
              const effectiveUpiApp = isUPIMethod(paymentMethod)
                ? (selectedUpiApp !== 'auto'
                    ? selectedUpiApp
                    : detectedLenderApp.isKnownApp
                    ? detectedLenderApp.appId
                    : null)
                : null;

              const methodLabel = isUPIMethod(paymentMethod) && effectiveUpiApp
                ? `UPI (${effectiveUpiApp.toUpperCase()})`
                : PAYMENT_METHOD_LABELS[paymentMethod]?.label || paymentMethod.toUpperCase();

              const fullNotes = [
                note.trim(),
                effectiveUpiApp ? `[UPI App: ${effectiveUpiApp.toUpperCase()}]` : null,
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

  const paymentMethodsList = PRIMARY_PAYMENT_METHODS;

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

        {isCurrentUserIsolated && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 font-mono text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">security</span>
            <span>Your account is currently quarantined in security isolation. Submitting payments is disabled.</span>
          </div>
        )}

        {/* Borrower Payment Information Card: Conditional on Lender's Preferred Repayment Method */}
        {!isLender && (
          <div className="space-y-2.5">
            {/* If lender has configured both UPI and Bank Transfer, offer a channel switcher */}
            {hasBothMethods && (
              <div className="grid grid-cols-2 p-1 rounded-xl bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/20 text-xs font-mono font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setRepaymentChannel('upi');
                    setPaymentMethod('upi');
                  }}
                  className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    repaymentChannel === 'upi'
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                      : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">qr_code_2</span>
                  <span>UPI &amp; QR {lenderProfile?.preferred_repayment_method === 'upi' ? '(Preferred)' : ''}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRepaymentChannel('bank');
                    setPaymentMethod('bank_transfer');
                  }}
                  className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    repaymentChannel === 'bank'
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                      : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">account_balance</span>
                  <span>Bank Account {lenderProfile?.preferred_repayment_method === 'bank_transfer' ? '(Preferred)' : ''}</span>
                </button>
              </div>
            )}

            {/* CHANNEL 1: UPI & QR Code (ONLY rendered if repaymentChannel is 'upi' AND lender has UPI ID) */}
            {repaymentChannel === 'upi' && lenderProfile?.upi_id && (
              <div className="p-3.5 rounded-2xl bg-gradient-to-br from-[var(--primary)]/10 via-[var(--surface-container)] to-[var(--surface-container-high)] border border-[var(--primary)]/25 space-y-3">
                {/* Header: Title + Trust Badge */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[20px] text-[var(--primary)]">qr_code_scanner</span>
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--on-surface)]">
                      Instant UPI Repayment
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">verified</span>
                    <span>Bank Approved</span>
                  </span>
                </div>

                {/* Payee Info Bar */}
                <div className="flex items-center justify-between text-xs font-mono bg-[var(--surface-container-lowest)] p-2.5 rounded-xl border border-[var(--outline-variant)]/20 gap-2">
                  <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[var(--on-surface-variant)] text-[11px]">Payee VPA:</span>
                    <span className="font-bold text-[var(--on-surface)] truncate">{lenderProfile.upi_id}</span>
                    {detectedLenderApp.isKnownApp && (
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${detectedLenderApp.badgeClass} flex items-center gap-1 shrink-0`}>
                        <span className="material-symbols-outlined text-[12px]">{detectedLenderApp.icon}</span>
                        <span>{detectedLenderApp.name}{detectedLenderApp.bank ? ` (${detectedLenderApp.bank})` : ''}</span>
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(lenderProfile.upi_id!, 'vpa')}
                    className="text-[var(--primary)] hover:underline shrink-0 ml-auto font-bold flex items-center gap-1 cursor-pointer text-xs"
                    title="Copy UPI ID"
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {copiedField === 'vpa' ? 'check' : 'content_copy'}
                    </span>
                    <span>{copiedField === 'vpa' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>

                {/* Segmented Mode Selector: QR Code vs Pay in App */}
                <div className="grid grid-cols-2 p-1 rounded-xl bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/20 text-xs font-mono font-bold">
                  <button
                    type="button"
                    onClick={() => setUpiPayTab('qr')}
                    className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      upiPayTab === 'qr'
                        ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                        : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">qr_code_2</span>
                    <span>Scan QR Code</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpiPayTab('app')}
                    className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      upiPayTab === 'app'
                        ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                        : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    <span>Pay in UPI App</span>
                  </button>
                </div>

                {/* Mode 1: QR Code Scanner (100% immune to bank rejects) */}
                {upiPayTab === 'qr' && (
                  <div className="space-y-2.5 animate-in fade-in duration-150">
                    <div className="p-3 bg-white rounded-2xl text-center shadow-sm border border-neutral-200 dark:border-neutral-800">
                      {generatingQr ? (
                        <div className="w-48 h-48 flex items-center justify-center mx-auto text-neutral-500 font-mono text-xs">
                          Generating QR...
                        </div>
                      ) : qrCodeDataUrl ? (
                        <div className="space-y-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={qrCodeDataUrl}
                            alt="UPI Payment QR Code"
                            className="w-48 h-48 mx-auto rounded-xl"
                          />
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-800 text-[11px] font-mono font-bold">
                            <span>Amount:</span>
                            <span className="text-emerald-700">
                              {formatCurrency(amount > 0 ? amount : currentBalance, debt.currency || 'inr', { showDecimals: true })}
                            </span>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* QR Actions: Save / Share for gallery scan, Copy UPI ID */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleShareOrSaveQR}
                        className="flex-1 min-h-[44px] py-2 px-3 rounded-xl bg-[var(--surface)] border border-[var(--outline-variant)]/40 text-[var(--on-surface)] font-mono text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-[var(--surface-container)] active:scale-[0.98] transition-all cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">
                          {copiedField === 'qr-download' ? 'check' : 'file_download'}
                        </span>
                        <span>{copiedField === 'qr-download' ? 'QR Saved!' : 'Save QR to Photos'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => copyToClipboard(lenderProfile.upi_id!, 'vpa')}
                        className="min-h-[44px] py-2 px-3.5 rounded-xl bg-[var(--surface)] border border-[var(--outline-variant)]/40 text-[var(--on-surface)] font-mono text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-[var(--surface-container)] active:scale-[0.98] transition-all cursor-pointer shrink-0"
                      >
                        <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">
                          {copiedField === 'vpa' ? 'check' : 'content_copy'}
                        </span>
                        <span>{copiedField === 'vpa' ? 'Copied' : 'Copy ID'}</span>
                      </button>
                    </div>

                    {/* Quick direct launcher for user's own profile app if detected */}
                    {userPreferredApp && (
                      <a
                        href={activeUpiLink ? getUPIAppLaunchUrl(userPreferredApp.id, activeUpiLink) : '#'}
                        onClick={(e) => handleLaunchApp(e, userPreferredApp.id, userPreferredApp.name)}
                        target="_top"
                        rel="noopener noreferrer"
                        className="w-full min-h-[44px] py-2 px-3 rounded-xl bg-[var(--primary)]/10 hover:bg-[var(--primary)]/15 border border-[var(--primary)]/30 text-[var(--primary)] font-mono text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                      >
                        <span className="material-symbols-outlined text-[16px]">{userPreferredApp.icon}</span>
                        <span>Have {userPreferredApp.shortName}? Copy ID &amp; Open {userPreferredApp.shortName} Directly</span>
                      </a>
                    )}

                    <div className="p-2.5 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 text-[11px] font-mono text-[var(--on-surface-variant)] space-y-1">
                      <div className="flex items-center gap-1.5 text-[var(--on-surface)] font-semibold">
                        <span className="material-symbols-outlined text-[14px] text-emerald-600">verified</span>
                        <span>Guaranteed Bank Approval:</span>
                      </div>
                      <p className="leading-relaxed">
                        • <strong>From another phone/laptop:</strong> Point your GPay, PhonePe, Paytm, or BHIM camera directly at this QR.
                      </p>
                      <p className="leading-relaxed">
                        • <strong>On this phone:</strong> Tap &ldquo;Save QR to Photos&rdquo; above. In your UPI app, open camera scanner and tap the <strong>Gallery/Photos icon</strong> to select this QR.
                      </p>
                    </div>
                  </div>
                )}

                {/* Mode 2: Pay in App (1-Tap Copy & Open) */}
                {upiPayTab === 'app' && (
                  <div className="space-y-2.5 animate-in fade-in duration-150">
                    {/* Active Feedback Banner if user clicked an app */}
                    {launchStatus && (
                      <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-mono text-xs flex items-center gap-2 animate-in fade-in zoom-in-95 duration-150">
                        <span className="material-symbols-outlined text-[18px] text-emerald-600">check_circle</span>
                        <span className="font-semibold">{launchStatus}</span>
                      </div>
                    )}

                    <div className="p-2.5 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 text-xs font-mono space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--on-surface-variant)] text-[11px]">Payee UPI ID:</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(lenderProfile.upi_id!, 'vpa')}
                          className="text-[var(--primary)] font-bold hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[13px]">content_copy</span>
                          <span>{copiedField === 'vpa' ? 'Copied!' : 'Copy ID'}</span>
                        </button>
                      </div>
                      <div className="font-bold text-[var(--on-surface)] select-all break-all bg-[var(--surface-container)] px-2.5 py-1.5 rounded-lg border border-[var(--outline-variant)]/20">
                        {lenderProfile.upi_id}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[var(--on-surface-variant)] text-[11px]">Exact Amount:</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(String(round2(amount > 0 ? amount : maxAllowable).toFixed(2)), 'amt')}
                          className="text-[var(--primary)] font-bold hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[13px]">content_copy</span>
                          <span>{copiedField === 'amt' ? 'Copied!' : 'Copy Amount'}</span>
                        </button>
                      </div>
                      <div className="font-bold text-base text-[var(--on-surface)] bg-[var(--surface-container)] px-2.5 py-1.5 rounded-lg border border-[var(--outline-variant)]/20">
                        {formatCurrency(round2(amount > 0 ? amount : maxAllowable), debt.currency || 'inr', { showDecimals: true })}
                      </div>
                    </div>

                    {/* Amount Pre-fill Switch: Protects against bank collect rejections */}
                    <div className="flex items-center justify-between text-xs font-mono p-2.5 rounded-xl bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/20">
                      <div className="flex items-center gap-1.5 text-[var(--on-surface)]">
                        <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">tune</span>
                        <span className="font-semibold">Auto-fill Amount in App:</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPrefillAmount(!prefillAmount)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                          prefillAmount
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {prefillAmount ? '✓ ON (Auto-fill)' : 'OFF (Manual - 100% Approval)'}
                      </button>
                    </div>

                    {/* 1st / Preferred App: Prominent Header Button if matched to Paying User's Profile */}
                    {userPreferredApp && (
                      <div className="p-3 rounded-2xl bg-gradient-to-r from-[var(--primary)]/15 via-[var(--surface-container)] to-[var(--surface-container-high)] border border-[var(--primary)]/35 space-y-2 shadow-xs animate-in fade-in duration-150">
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="font-bold text-[var(--primary)] flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[16px] text-amber-500 fill-amber-500">star</span>
                            <span>Your Primary UPI App: {userPreferredApp.name}</span>
                          </span>
                          <span className="text-[10px] text-[var(--on-surface-variant)] px-2 py-0.5 rounded-md bg-[var(--surface)] border border-[var(--outline-variant)]/30 truncate max-w-[150px]">
                            {currentUserUpiId}
                          </span>
                        </div>
                        <a
                          href={activeUpiLink ? getUPIAppLaunchUrl(userPreferredApp.id, activeUpiLink) : '#'}
                          onClick={(e) => handleLaunchApp(e, userPreferredApp.id, userPreferredApp.name)}
                          target="_top"
                          rel="noopener noreferrer"
                          className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-[var(--primary)] hover:brightness-110 active:scale-[0.98] text-[var(--on-primary)] font-mono text-xs font-bold flex items-center justify-between transition-all cursor-pointer shadow-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px]">{userPreferredApp.icon}</span>
                            <span>Open {userPreferredApp.shortName} &amp; Pay</span>
                          </div>
                          <div className="flex items-center gap-1 text-[11px] opacity-90 font-semibold">
                            <span>1-Tap Copy &amp; Open</span>
                            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                          </div>
                        </a>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <label className="font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">
                          {userPreferredApp ? 'All Supported UPI Apps:' : 'Tap to Copy &amp; Open Your UPI App:'}
                        </label>
                        {userPreferredApp && (
                          <span className="text-[10px] text-[var(--primary)] font-semibold">
                            {userPreferredApp.shortName} prioritized on top
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {sortedApps.map((app) => (
                          <a
                            key={app.id}
                            href={activeUpiLink ? getUPIAppLaunchUrl(app.id, activeUpiLink) : '#'}
                            onClick={(e) => handleLaunchApp(e, app.id, app.name)}
                            target="_top"
                            rel="noopener noreferrer"
                            className={`min-h-[44px] py-2 px-2.5 rounded-xl border text-[var(--on-surface)] font-mono text-xs font-semibold flex items-center justify-between gap-1.5 transition-all cursor-pointer active:scale-[0.98] ${
                              app.isUserPreferred
                                ? 'border-[var(--primary)]/60 bg-[var(--primary)]/10 text-[var(--primary)] shadow-2xs font-bold ring-1 ring-[var(--primary)]/30'
                                : 'border-[var(--outline-variant)]/30 bg-[var(--surface)] hover:bg-[var(--surface-container)]'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="material-symbols-outlined text-[16px] text-[var(--primary)] shrink-0">{app.icon}</span>
                              <span className="truncate">{app.shortName}</span>
                            </div>
                            {app.isUserPreferred ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[var(--primary)] text-[var(--on-primary)] shrink-0">
                                1st
                              </span>
                            ) : (
                              <span className="material-symbols-outlined text-[13px] text-[var(--outline)] shrink-0">open_in_new</span>
                            )}
                          </a>
                        ))}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 text-[11px] font-mono text-[var(--on-surface-variant)] space-y-1">
                      <div className="font-semibold text-[var(--on-surface)]">How to complete payment:</div>
                      <p>1. Tap your app button above (UPI ID copies automatically).</p>
                      <p>2. In your app, tap <strong>&ldquo;Pay to UPI ID&rdquo;</strong> (or &ldquo;To UPI ID / Number&rdquo;) and paste.</p>
                      <p>3. Enter the exact amount ({formatCurrency(round2(amount > 0 ? amount : maxAllowable), debt.currency || 'inr', { showDecimals: true })}) and complete payment.</p>
                    </div>
                  </div>
                )}

                {/* Bank Rejection Explanation Accordion */}
                <div className="pt-1 border-t border-[var(--outline-variant)]/20">
                  <button
                    type="button"
                    onClick={() => setShowBankExplainer(!showBankExplainer)}
                    className="w-full text-left flex items-center justify-between text-[11px] font-mono text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] transition-colors py-1 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                      <span className="material-symbols-outlined text-[14px]">help</span>
                      <span className="font-semibold">Why do banks decline direct web links?</span>
                    </div>
                    <span className="material-symbols-outlined text-[14px] text-[var(--outline)]">
                      {showBankExplainer ? 'expand_less' : 'expand_more'}
                    </span>
                  </button>

                  {showBankExplainer && (
                    <div className="p-2.5 mt-1.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] font-mono text-amber-900 dark:text-amber-200 space-y-2 animate-in fade-in duration-150">
                      <p className="leading-relaxed">
                        <strong>NPCI &amp; Bank Policy:</strong> Indian banks (SBI, HDFC, ICICI, etc.) reject direct browser links to personal UPI accounts to prevent phishing scams.
                      </p>
                      <p className="leading-relaxed">
                        Scanning the QR code or pasting the UPI ID into your UPI app initiates the payment safely inside the certified banking app, guaranteeing 100% bank approval.
                      </p>
                    </div>
                  )}
                </div>

                <p className="text-[10px] font-mono text-[var(--on-surface-variant)] leading-relaxed">
                  💡 After completing payment in your UPI app, copy the 12-digit UPI Ref/UTR number and paste it below.
                </p>
              </div>
            )}

            {/* CHANNEL 2: Bank Account Transfer Details Card */}
            {repaymentChannel === 'bank' && (lenderProfile?.bank_account_number || lenderProfile?.bank_ifsc) && (
              <div className="p-3.5 rounded-2xl bg-gradient-to-br from-teal-500/10 via-[var(--surface-container)] to-[var(--surface-container-high)] border border-teal-500/30 space-y-3 animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[20px] text-teal-600 dark:text-teal-400">account_balance</span>
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--on-surface)]">
                      Direct Bank Transfer (IMPS / NEFT)
                    </span>
                  </div>
                  {lenderProfile?.preferred_repayment_method === 'bank_transfer' && (
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/25">
                      Lender Preferred
                    </span>
                  )}
                </div>

                {/* Details Grid */}
                <div className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 space-y-2.5 text-xs font-mono">
                  {/* Account Holder */}
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--on-surface-variant)] text-[11px]">Beneficiary Name:</span>
                    <div className="flex items-center gap-1.5 font-bold text-[var(--on-surface)]">
                      <span>{lenderProfile.bank_account_holder_name || lenderProfile.full_name || 'Lender'}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(lenderProfile.bank_account_holder_name || lenderProfile.full_name || '', 'name')}
                        className="text-[var(--primary)] hover:underline flex items-center gap-0.5 cursor-pointer text-[11px]"
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          {copiedField === 'name' ? 'check' : 'content_copy'}
                        </span>
                        <span>{copiedField === 'name' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Bank Name */}
                  {lenderProfile.bank_name && (
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--on-surface-variant)] text-[11px]">Bank Name:</span>
                      <span className="font-semibold text-[var(--on-surface)]">{lenderProfile.bank_name}</span>
                    </div>
                  )}

                  {/* Account Number */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[var(--on-surface-variant)] text-[11px]">Account Number:</span>
                      <button
                        type="button"
                        onClick={() => setShowMaskedAccount(!showMaskedAccount)}
                        className="text-[var(--outline)] hover:text-[var(--on-surface)] text-[10px] flex items-center"
                        title={showMaskedAccount ? 'Hide' : 'Reveal'}
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          {showMaskedAccount ? 'visibility_off' : 'visibility'}
                        </span>
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 font-bold text-[var(--on-surface)]">
                      <span className="select-all">
                        {showMaskedAccount
                          ? lenderProfile.bank_account_number
                          : maskBankAccount(lenderProfile.bank_account_number)}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(lenderProfile.bank_account_number || '', 'acc')}
                        className="text-[var(--primary)] hover:underline flex items-center gap-0.5 cursor-pointer text-[11px]"
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          {copiedField === 'acc' ? 'check' : 'content_copy'}
                        </span>
                        <span>{copiedField === 'acc' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  {/* IFSC Code */}
                  {lenderProfile.bank_ifsc && (
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--on-surface-variant)] text-[11px]">IFSC Code:</span>
                      <div className="flex items-center gap-1.5 font-bold text-[var(--on-surface)]">
                        <span className="select-all uppercase">{lenderProfile.bank_ifsc}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(lenderProfile.bank_ifsc || '', 'ifsc')}
                          className="text-[var(--primary)] hover:underline flex items-center gap-0.5 cursor-pointer text-[11px]"
                        >
                          <span className="material-symbols-outlined text-[13px]">
                            {copiedField === 'ifsc' ? 'check' : 'content_copy'}
                          </span>
                          <span>{copiedField === 'ifsc' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Transfer Amount */}
                  <div className="flex items-center justify-between pt-1 border-t border-[var(--outline-variant)]/20">
                    <span className="text-[var(--on-surface-variant)] text-[11px]">Exact Amount:</span>
                    <div className="flex items-center gap-1.5 font-bold text-[var(--on-surface)] text-sm">
                      <span>{formatCurrency(round2(amount > 0 ? amount : maxAllowable), debt.currency || 'inr', { showDecimals: true })}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(String(round2(amount > 0 ? amount : maxAllowable).toFixed(2)), 'amt')}
                        className="text-[var(--primary)] hover:underline flex items-center gap-0.5 cursor-pointer text-[11px]"
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          {copiedField === 'amt' ? 'check' : 'content_copy'}
                        </span>
                        <span>{copiedField === 'amt' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Instructions */}
                <div className="p-2.5 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 text-[11px] font-mono text-[var(--on-surface-variant)] space-y-1">
                  <div className="font-semibold text-[var(--on-surface)]">How to settle via NetBanking:</div>
                  <p>1. Copy the account number &amp; IFSC above.</p>
                  <p>2. Open your NetBanking or mobile banking app and initiate an IMPS / NEFT transfer.</p>
                  <p>3. Enter the UTR / transaction reference number below so the lender can verify and reconcile.</p>
                </div>
              </div>
            )}

            {/* When lender has no details configured on file */}
            {!hasUpi && !hasBank && (
              <div className="p-3.5 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 text-xs font-mono space-y-2">
                <div className="flex items-center gap-2 text-[var(--on-surface)] font-bold">
                  <span className="material-symbols-outlined text-[18px] text-amber-500">info</span>
                  <span>No UPI ID or Bank Account Configured</span>
                </div>
                <p className="text-[var(--on-surface-variant)] leading-relaxed">
                  The counterparty hasn&rsquo;t configured their payment receiving details yet. You can settle in cash or ask them to add their UPI ID or Bank Account in Settings.
                </p>
              </div>
            )}
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

        {/* Amount Input with Quick Chips & 2-Decimal Trust Guidance */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] font-bold">
              Payment Amount
            </label>
            {maxAllowable > 0 && (
              <button
                type="button"
                onClick={() => setAmountUnified(round2(maxAllowable))}
                className="font-mono text-xs text-[var(--primary)] font-bold hover:underline cursor-pointer"
              >
                Pay Full ({formatCurrency(round2(maxAllowable), debt.currency || 'inr', { showDecimals: true })})
              </button>
            )}
          </div>

          <div className="relative">
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
              onBlur={handleAmountBlur}
              onFocus={(e) => e.target.select()}
              className="w-full pl-4 pr-16 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-lg font-bold outline-none focus:border-[var(--primary)] disabled:opacity-50 disabled:bg-[var(--surface-container-low)]"
            />
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-xs font-bold text-[var(--on-surface-variant)] pointer-events-none uppercase">
              {debt.currency || 'INR'}
            </div>
          </div>

          {/* Quick Amount Chips */}
          {maxAllowable > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[10px] font-mono text-[var(--outline)] uppercase font-semibold">
                Quick:
              </span>
              <button
                type="button"
                onClick={() => setAmountUnified(round2(maxAllowable))}
                className="px-2 py-1 rounded-lg bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--primary)] border border-[var(--primary)]/30 font-mono text-xs font-bold transition-all cursor-pointer"
              >
                Full ({formatCurrency(round2(maxAllowable), debt.currency || 'inr', { showDecimals: true })})
              </button>
              {maxAllowable >= 100 && (
                <button
                  type="button"
                  onClick={() => setAmountUnified(round2(maxAllowable / 2))}
                  className="px-2 py-1 rounded-lg bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] border border-[var(--outline-variant)]/30 font-mono text-xs font-semibold transition-all cursor-pointer"
                >
                  50% ({formatCurrency(round2(maxAllowable / 2), debt.currency || 'inr', { showDecimals: true })})
                </button>
              )}
              {maxAllowable > 500 && (
                <button
                  type="button"
                  onClick={() => setAmountUnified(500)}
                  className="px-2 py-1 rounded-lg bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] border border-[var(--outline-variant)]/30 font-mono text-xs font-semibold transition-all cursor-pointer"
                >
                  {formatCurrency(500, debt.currency || 'inr', { showDecimals: true })}
                </button>
              )}
              {maxAllowable > 1000 && (
                <button
                  type="button"
                  onClick={() => setAmountUnified(1000)}
                  className="px-2 py-1 rounded-lg bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] border border-[var(--outline-variant)]/30 font-mono text-xs font-semibold transition-all cursor-pointer"
                >
                  {formatCurrency(1000, debt.currency || 'inr', { showDecimals: true })}
                </button>
              )}
            </div>
          )}

          {/* User Trust & Precision Guidance */}
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-start gap-2 text-xs font-mono text-blue-900 dark:text-blue-200">
            <span className="material-symbols-outlined text-[15px] text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
              verified_user
            </span>
            <div className="leading-relaxed">
              <strong>System Trust &amp; Precision:</strong> Please enter the exact payment amount matching your bank transfer receipt (with 2 decimal places, e.g.{' '}
              <span className="font-bold underline">
                {round2(amount > 0 ? amount : maxAllowable).toFixed(2)}
              </span>
              ) for instant ledger verification and maintaining a high borrower trust score.
            </div>
          </div>
        </div>

        {/* Payment Method Selector */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block">
              Payment Mode
            </label>
            {paymentMethod === 'upi' && (
              <span className="font-mono text-[10px] text-[var(--primary)] font-semibold">
                Unified Payments Interface
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {paymentMethodsList.map((m) => {
              const meta = PAYMENT_METHOD_LABELS[m];
              const isSelected = paymentMethod === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`px-3 py-2 rounded-xl font-mono text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                      : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{meta?.icon || 'payment'}</span>
                  <span>{meta?.label || m}</span>
                </button>
              );
            })}
          </div>
          {paymentMethod === 'upi' && (
            <p className="text-[11px] font-mono text-[var(--on-surface-variant)] mt-1.5">
              Supports Google Pay, PhonePe, Paytm, BHIM, CRED, Navi, and all Indian Bank UPI apps.
            </p>
          )}
        </div>

        {/* When UPI is chosen: App specification / auto-detection */}
        {paymentMethod === 'upi' && (
          <div className="p-2.5 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/20 space-y-1.5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[var(--on-surface-variant)] font-semibold">
                Which UPI App was used?
              </span>
              {detectedLenderApp.isKnownApp && selectedUpiApp === 'auto' && (
                <span className="text-[10px] text-[var(--primary)] font-semibold">
                  Detected from payee: {detectedLenderApp.name}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedUpiApp('auto')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-colors cursor-pointer ${
                  selectedUpiApp === 'auto'
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] font-bold'
                    : 'bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                {detectedLenderApp.isKnownApp ? `Auto (${detectedLenderApp.shortName})` : 'Auto-detect'}
              </button>
              {UPI_SUB_APPS.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelectedUpiApp(app.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-colors cursor-pointer ${
                    selectedUpiApp === app.id
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] font-bold'
                      : 'bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                  }`}
                >
                  {app.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Transaction Reference ID Input (Compulsory for non-cash) */}
        {paymentMethod !== 'cash' ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] flex items-center gap-1 font-bold">
                <span>
                  {paymentMethod === 'upi' ? 'UPI UTR / 12-Digit Reference' : 'Transaction Ref / ID'}
                </span>
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
                paymentMethod === 'upi'
                  ? selectedUpiApp !== 'auto' && selectedUpiApp !== 'other'
                    ? `12-digit UTR from ${selectedUpiApp === 'gpay' ? 'Google Pay' : selectedUpiApp === 'phonepe' ? 'PhonePe' : selectedUpiApp === 'paytm' ? 'Paytm' : selectedUpiApp.toUpperCase()}`
                    : detectedLenderApp.isKnownApp
                    ? `12-digit UTR from ${detectedLenderApp.name}`
                    : '12-digit UPI UTR number (e.g. 412345678901)'
                  : PAYMENT_METHOD_LABELS[paymentMethod]?.placeholder || 'Enter transaction reference'
              }
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] font-mono text-base md:text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30"
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
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-base md:text-sm outline-none focus:border-[var(--primary)] disabled:opacity-50"
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
            disabled={loading || checkingLimits || isBlockedByPending || isCurrentUserIsolated}
            className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--secondary)] text-[var(--on-secondary)] font-mono text-xs font-bold hover:opacity-95 disabled:opacity-50"
          >
            {loading
              ? 'Submitting...'
              : checkingLimits
              ? 'Checking...'
              : isCurrentUserIsolated
              ? 'Account Quarantined'
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
