'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment, Profile, PaymentMethod } from '@/lib/types/database';
import { calculateDebtBalance, round2 } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { sendNotificationEmail } from '@/lib/utils/email-notifier';
import {
  generateUPILink,
  generateUPIQRCodeDataURL,
  detectUPIApp,
  getSortedUPIAppsForUser,
  maskBankAccount,
  isValidIFSC,
} from '@/lib/utils/upi-link';

export type RepayAllocationStrategy = 'avalanche' | 'due_date' | 'fifo';

interface PersonRepaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  person: Profile;
  debts: Debt[];
  payments: Payment[];
  currentUserId: string;
  currency?: string;
  initialSelectedDebtId?: string | null;
  onPaymentRecorded?: () => void;
}

export function PersonRepaymentModal({
  isOpen,
  onClose,
  person,
  debts,
  payments,
  currentUserId,
  currency = 'inr',
  initialSelectedDebtId,
  onPaymentRecorded,
}: PersonRepaymentModalProps) {
  const supabase = useMemo(() => createClient(), []);

  // 1. Filter all active debts where the current user is the borrower
  const eligibleDebts = useMemo(() => {
    return debts
      .filter((d) => d.status === 'active' && d.borrower_id === currentUserId)
      .map((d) => {
        const debtPayments = payments.filter((p) => p.debt_id === d.id);
        const calc = calculateDebtBalance(d, debtPayments);
        const pendingAmount = calc.pendingVerificationPaid || 0;
        const allowableBalance = Math.max(0, round2(calc.currentBalance - pendingAmount));
        return {
          debt: d,
          currentBalance: calc.currentBalance,
          allowableBalance,
          pendingAmount,
          accruedInterest: calc.totalAccruedInterest,
          rate: Number(d.interest_rate) || 0,
        };
      })
      .filter((item) => item.allowableBalance > 0);
  }, [debts, payments, currentUserId]);

  const totalOwedAll = useMemo(() => {
    return round2(eligibleDebts.reduce((sum, item) => sum + item.allowableBalance, 0));
  }, [eligibleDebts]);

  // 2. Selection states
  const hasMultipleDebts = eligibleDebts.length > 1;
  const [repayMode, setRepayMode] = useState<'single' | 'bulk'>('single');
  const [selectedDebtId, setSelectedDebtId] = useState<string>('');
  const [strategy, setStrategy] = useState<RepayAllocationStrategy>('avalanche');

  // Amount states
  const [amountStr, setAmountStr] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);

  // Payment channel states
  const [repaymentChannel, setRepaymentChannel] = useState<'upi' | 'bank' | 'cash'>('upi');
  const [upiViewTab, setUpiViewTab] = useState<'qr' | 'app'>('qr');
  const [prefillAmount, setPrefillAmount] = useState<boolean>(true);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [generatingQr, setGeneratingQr] = useState<boolean>(false);
  const [showMaskedAccount, setShowMaskedAccount] = useState<boolean>(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);

  // Form states
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi');
  const [transactionRef, setTransactionRef] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [currentUserUpiId, setCurrentUserUpiId] = useState<string | null>(null);
  const [isCurrentUserIsolated, setIsCurrentUserIsolated] = useState<boolean>(false);

  // Fetch current user details (profile UPI ID and isolation)
  useEffect(() => {
    if (!isOpen) return;
    async function loadCurrentUser() {
      try {
        const user = await getCurrentUserFast(supabase);
        if (!user) return;
        const { data: myProf } = await supabase
          .from('profiles')
          .select('is_isolated, upi_id')
          .eq('id', user.id)
          .single();
        if (myProf) {
          setIsCurrentUserIsolated(Boolean(myProf.is_isolated));
          if (myProf.upi_id) setCurrentUserUpiId(myProf.upi_id);
        }
      } catch (_) {}
    }
    loadCurrentUser();
  }, [isOpen, supabase]);

  // Determine counterparty capabilities
  const hasUpi = Boolean(person?.upi_id?.trim());
  const hasBank = Boolean(
    person?.bank_account_number?.trim() || person?.bank_ifsc?.trim()
  );

  // Auto-sort UPI apps so the paying user's own profile app appears 1st on top
  const { sortedApps, userPreferredApp } = useMemo(
    () => getSortedUPIAppsForUser(currentUserUpiId),
    [currentUserUpiId]
  );

  // Initialize selected debt on open or change
  useEffect(() => {
    if (!isOpen) return;

    if (initialSelectedDebtId && eligibleDebts.some((d) => d.debt.id === initialSelectedDebtId)) {
      setSelectedDebtId(initialSelectedDebtId);
      setRepayMode('single');
      const item = eligibleDebts.find((d) => d.debt.id === initialSelectedDebtId);
      if (item) {
        setAmount(item.allowableBalance);
        setAmountStr(item.allowableBalance.toFixed(2));
      }
    } else if (eligibleDebts.length > 0) {
      const defaultId = eligibleDebts[0].debt.id;
      setSelectedDebtId(defaultId);
      if (!hasMultipleDebts) {
        setRepayMode('single');
        setAmount(eligibleDebts[0].allowableBalance);
        setAmountStr(eligibleDebts[0].allowableBalance.toFixed(2));
      } else {
        // Default to bulk repaying full amount or single first debt
        setRepayMode('single');
        setAmount(eligibleDebts[0].allowableBalance);
        setAmountStr(eligibleDebts[0].allowableBalance.toFixed(2));
      }
    }

    // Default channel
    if (person?.preferred_repayment_method === 'bank_transfer' && hasBank) {
      setRepaymentChannel('bank');
      setPaymentMethod('bank_transfer');
    } else if (hasUpi) {
      setRepaymentChannel('upi');
      setPaymentMethod('upi');
    } else if (hasBank) {
      setRepaymentChannel('bank');
      setPaymentMethod('bank_transfer');
    } else {
      setRepaymentChannel('cash');
      setPaymentMethod('cash');
    }
    setError('');
  }, [isOpen, initialSelectedDebtId, eligibleDebts, hasMultipleDebts, person, hasUpi, hasBank]);

  // Handle switching between single and bulk modes
  const handleSwitchMode = (mode: 'single' | 'bulk') => {
    setRepayMode(mode);
    if (mode === 'bulk') {
      setAmount(totalOwedAll);
      setAmountStr(totalOwedAll > 0 ? totalOwedAll.toFixed(2) : '');
    } else {
      const currentItem = eligibleDebts.find((d) => d.debt.id === selectedDebtId) || eligibleDebts[0];
      if (currentItem) {
        setSelectedDebtId(currentItem.debt.id);
        setAmount(currentItem.allowableBalance);
        setAmountStr(currentItem.allowableBalance.toFixed(2));
      }
    }
  };

  const handleSelectDebt = (debtId: string) => {
    setSelectedDebtId(debtId);
    const item = eligibleDebts.find((d) => d.debt.id === debtId);
    if (item) {
      setAmount(item.allowableBalance);
      setAmountStr(item.allowableBalance.toFixed(2));
    }
  };

  // Selected single item
  const selectedDebtItem = useMemo(() => {
    return eligibleDebts.find((d) => d.debt.id === selectedDebtId) || eligibleDebts[0];
  }, [eligibleDebts, selectedDebtId]);

  // Maximum payable in current mode
  const maxPayable = repayMode === 'single' ? (selectedDebtItem?.allowableBalance || 0) : totalOwedAll;

  // Amount input handler
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

  const setAmountPreset = (val: number) => {
    const formatted = round2(val);
    setAmount(formatted);
    setAmountStr(formatted > 0 ? formatted.toFixed(2) : '');
  };

  // Compute bulk allocations across eligible debts
  const bulkAllocations = useMemo(() => {
    if (repayMode !== 'bulk') return [];
    const paymentSum = amount;
    if (paymentSum <= 0 || eligibleDebts.length === 0) return [];

    const sorted = [...eligibleDebts].sort((a, b) => {
      if (strategy === 'avalanche') return b.rate - a.rate;
      if (strategy === 'due_date') {
        const dateA = a.debt.due_date ? new Date(a.debt.due_date).getTime() : Infinity;
        const dateB = b.debt.due_date ? new Date(b.debt.due_date).getTime() : Infinity;
        return dateA - dateB;
      }
      return new Date(a.debt.created_at).getTime() - new Date(b.debt.created_at).getTime();
    });

    let remainingFund = paymentSum;
    return sorted.map((item) => {
      if (remainingFund <= 0) {
        return {
          debt: item.debt,
          currentBalance: item.currentBalance,
          allowableBalance: item.allowableBalance,
          allocated: 0,
          newBalance: item.currentBalance,
          rate: item.rate,
        };
      }
      const allocated = Math.min(remainingFund, item.allowableBalance);
      remainingFund -= allocated;
      return {
        debt: item.debt,
        currentBalance: item.currentBalance,
        allowableBalance: item.allowableBalance,
        allocated,
        newBalance: Math.max(0, item.currentBalance - allocated),
        rate: item.rate,
      };
    });
  }, [repayMode, amount, eligibleDebts, strategy]);

  // UPI Link and QR generation
  const activeDebtRef = repayMode === 'single' && selectedDebtItem ? selectedDebtItem.debt.id.slice(0, 6) : 'BULK';
  const upiLink = person?.upi_id
    ? generateUPILink(
        person.upi_id,
        person.full_name || 'Payee',
        amount > 0 ? amount : undefined,
        currency,
        `DebtSync Repayment ${activeDebtRef}`
      )
    : '';

  useEffect(() => {
    if (!upiLink || repaymentChannel !== 'upi') {
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
  }, [upiLink, repaymentChannel]);

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
    if (!person?.upi_id) return;
    copyToClipboard(person.upi_id, 'vpa');

    const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '').toLowerCase() : '';
    const isMobile = /android|iphone|ipad|ipod/i.test(ua);

    if (!isMobile) {
      e.preventDefault();
      setLaunchStatus(
        `Copied UPI ID (${person.upi_id})! On desktop, scan the QR code or paste it into your mobile UPI app.`
      );
      setTimeout(() => setLaunchStatus(null), 6000);
      return;
    }

    setLaunchStatus(`Copied UPI ID (${person.upi_id})! Opening ${appName}... Verify payee and amount in app.`);
    setTimeout(() => setLaunchStatus(null), 6000);
  };

  // Submit payment
  const handleSubmitRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) {
      setError('Please enter a valid repayment amount greater than zero.');
      return;
    }
    if (amount > maxPayable + 0.01) {
      setError(`Amount cannot exceed the allowable balance of ${formatCurrency(maxPayable, currency)}.`);
      return;
    }
    if (isCurrentUserIsolated) {
      setError('Your account is placed in security quarantine. Repayment recording is restricted.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) throw new Error('You must be signed in to log a repayment.');

      if (repayMode === 'single') {
        if (!selectedDebtItem) throw new Error('Please select a loan to repay.');

        // Insert single payment
        const { error: pErr } = await supabase.from('payments').insert({
          debt_id: selectedDebtItem.debt.id,
          paid_by: user.id,
          amount: round2(amount),
          currency,
          payment_method: paymentMethod,
          transaction_ref: transactionRef.trim() || null,
          note: note.trim() || null,
          is_verified: false, // Must be verified by lender
        });

        if (pErr) throw pErr;

        // Activity log
        await supabase.from('activity_log').insert({
          user_id: user.id,
          debt_id: selectedDebtItem.debt.id,
          action: 'repayment_reported',
          details: {
            amount: round2(amount),
            payment_method: paymentMethod,
            transaction_ref: transactionRef.trim() || null,
            note: note.trim() || null,
          },
        });

        // Dispatch email notification to lender
        if (person?.email) {
          sendNotificationEmail({
            type: 'payment_request',
            recipientEmail: person.email,
            recipientName: person.full_name || 'Lender',
            senderName: user.user_metadata?.full_name || user.email || 'Borrower',
            amount: round2(amount),
            currency,
            notes: note.trim() || undefined,
          });
        }
      } else {
        // Bulk Repay Mode
        const validAllocations = bulkAllocations.filter((a) => a.allocated > 0);
        if (validAllocations.length === 0) {
          throw new Error('No eligible loans available to receive repayment allocations.');
        }

        for (const item of validAllocations) {
          const { error: pErr } = await supabase.from('payments').insert({
            debt_id: item.debt.id,
            paid_by: user.id,
            amount: item.allocated,
            currency: item.debt.currency || currency,
            payment_method: paymentMethod,
            transaction_ref: transactionRef.trim() || null,
            note: note.trim()
              ? `Bulk Repayment: ${note.trim()}`
              : `Smart Bulk Repayment (${strategy.toUpperCase()})`,
            is_verified: false,
          });

          if (pErr) throw pErr;

          await supabase.from('activity_log').insert({
            user_id: user.id,
            debt_id: item.debt.id,
            action: 'repayment_reported',
            details: {
              amount: item.allocated,
              strategy,
              transaction_ref: transactionRef.trim() || null,
            },
          });
        }

        if (person?.email) {
          sendNotificationEmail({
            type: 'payment_request',
            recipientEmail: person.email,
            recipientName: person.full_name || 'Lender',
            senderName: user.user_metadata?.full_name || user.email || 'Borrower',
            amount: round2(amount),
            currency,
            notes: note.trim() || `Smart Bulk Repayment across ${validAllocations.length} loans`,
          });
        }
      }

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      onPaymentRecorded?.();
      onClose();
    } catch (err: any) {
      console.error('Repayment error:', err);
      setError(err.message || 'Failed to record repayment.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Repay ${person?.full_name || person?.email || 'Contact'}`}
      subtitle={`Total allowable balance: ${formatCurrency(totalOwedAll, currency)}`}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmitRepayment} className="space-y-5">
        {/* Error Alert */}
        {error && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 font-mono text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">error</span>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('debtsync:open_bug_report', {
                    detail: { error, category: 'bug' },
                  })
                );
              }}
              className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-red-600 dark:text-red-400 hover:underline cursor-pointer shrink-0 self-end sm:self-auto bg-red-500/10 px-2 py-1 rounded-lg"
            >
              <span className="material-symbols-outlined text-[14px]">bug_report</span>
              <span>Report this issue</span>
            </button>
          </div>
        )}

        {isCurrentUserIsolated && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 font-mono text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">security</span>
            <span>Your account is in security quarantine. Repayments cannot be logged.</span>
          </div>
        )}

        {/* Status notification banner for app launch */}
        {launchStatus && (
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/30 text-primary font-mono text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] animate-pulse">launch</span>
            <span>{launchStatus}</span>
          </div>
        )}

        {/* 1. Mode Switcher (if multiple debts exist) */}
        {hasMultipleDebts && (
          <div className="bg-surface-container p-1 rounded-xl border border-outline-variant/30 flex">
            <button
              type="button"
              onClick={() => handleSwitchMode('single')}
              className={`flex-1 py-2 px-3 rounded-lg font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                repayMode === 'single'
                  ? 'bg-surface-container-lowest text-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">receipt_long</span>
              <span>Specific Loan</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode('bulk')}
              className={`flex-1 py-2 px-3 rounded-lg font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                repayMode === 'bulk'
                  ? 'bg-surface-container-lowest text-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">bolt</span>
              <span>Bulk Repay All ({eligibleDebts.length})</span>
            </button>
          </div>
        )}

        {/* 2. Debt Selector (when in single mode and multiple debts exist) */}
        {repayMode === 'single' && hasMultipleDebts && (
          <div className="space-y-2">
            <label className="font-mono text-xs uppercase tracking-wider text-on-surface-variant font-semibold block">
              Select Loan to Repay
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-48 overflow-y-auto overscroll-contain pr-1">
              {eligibleDebts.map((item) => {
                const isSelected = item.debt.id === selectedDebtId;
                const d = item.debt;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => handleSelectDebt(d.id)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-xs'
                        : 'border-outline-variant/30 bg-surface-container-low hover:border-outline-variant/60'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-mono text-xs font-bold text-on-surface truncate max-w-[140px]">
                        {d.notes || `Loan #${d.id.slice(0, 6)}`}
                      </span>
                      <span className={`font-mono text-xs font-bold ${isSelected ? 'text-primary' : 'text-on-surface'}`}>
                        {formatCurrency(item.allowableBalance, currency)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-on-surface-variant">
                      <span>{d.interest_rate ? `${d.interest_rate}% APR` : '0%'}</span>
                      {d.due_date && (
                        <span>• Due {new Date(d.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 2B. Bulk Strategy Selector (when in bulk mode) */}
        {repayMode === 'bulk' && (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="font-mono text-xs uppercase tracking-wider text-on-surface-variant font-semibold">
                Payoff Allocation Strategy
              </label>
              <span className="text-[11px] font-mono text-primary font-bold">
                Auto-splits lump sum
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'avalanche', label: 'Avalanche', desc: 'Highest APR first' },
                { id: 'due_date', label: 'Due Date', desc: 'Earliest deadline' },
                { id: 'fifo', label: 'FIFO', desc: 'Oldest loan first' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStrategy(s.id as RepayAllocationStrategy)}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    strategy === s.id
                      ? 'border-primary bg-primary/5 shadow-xs'
                      : 'border-outline-variant/30 bg-surface-container-low hover:border-outline-variant/60'
                  }`}
                >
                  <div className="font-mono text-xs font-bold text-on-surface">{s.label}</div>
                  <div className="text-[10px] text-on-surface-variant truncate">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 3. Amount Input & Quick Chips */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="font-mono text-xs uppercase tracking-wider text-on-surface-variant font-semibold">
              Repayment Amount ({currency.toUpperCase()}) <span className="text-red-500">*</span>
            </label>
            <span className="font-mono text-xs text-on-surface-variant">
              Max: <span className="font-bold text-on-surface">{formatCurrency(maxPayable, currency)}</span>
            </span>
          </div>

          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-base md:text-sm font-bold text-on-surface-variant">
              {currency === 'inr' ? '₹' : currency.toUpperCase()}
            </span>
            <input
              type="text"
              inputMode="decimal"
              required
              placeholder="0.00"
              value={amountStr}
              onChange={(e) => handleAmountChange(e.target.value)}
              onBlur={handleAmountBlur}
              className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-outline-variant/40 bg-surface text-on-surface font-mono text-base md:text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all font-bold"
            />
          </div>

          {/* Quick preset chips */}
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            <button
              type="button"
              onClick={() => setAmountPreset(maxPayable)}
              className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-all cursor-pointer"
            >
              Full Balance ({formatCurrency(maxPayable, currency)})
            </button>
            <button
              type="button"
              onClick={() => setAmountPreset(maxPayable * 0.5)}
              className="px-2.5 py-1 rounded-lg text-xs font-mono border border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
            >
              50% ({formatCurrency(maxPayable * 0.5, currency)})
            </button>
            <button
              type="button"
              onClick={() => setAmountPreset(maxPayable * 0.25)}
              className="px-2.5 py-1 rounded-lg text-xs font-mono border border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
            >
              25% ({formatCurrency(maxPayable * 0.25, currency)})
            </button>
          </div>
        </div>

        {/* 4. Payment Channel Tabs (UPI / Bank / Cash) */}
        <div className="space-y-3 pt-1 border-t border-outline-variant/20">
          <div className="flex justify-between items-center">
            <label className="font-mono text-xs uppercase tracking-wider text-on-surface-variant font-semibold">
              Payment Method & Channel
            </label>
            {person?.upi_id && (
              <span className="font-mono text-[11px] text-primary flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">account_balance_wallet</span>
                <span>{person.upi_id}</span>
              </span>
            )}
          </div>

          <div className="flex bg-surface-container p-1 rounded-xl border border-outline-variant/30">
            {hasUpi && (
              <button
                type="button"
                onClick={() => {
                  setRepaymentChannel('upi');
                  setPaymentMethod('upi');
                }}
                className={`flex-1 py-1.5 px-3 rounded-lg font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  repaymentChannel === 'upi'
                    ? 'bg-surface-container-lowest text-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">qr_code_2</span>
                <span>UPI Pay</span>
              </button>
            )}
            {hasBank && (
              <button
                type="button"
                onClick={() => {
                  setRepaymentChannel('bank');
                  setPaymentMethod('bank_transfer');
                }}
                className={`flex-1 py-1.5 px-3 rounded-lg font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  repaymentChannel === 'bank'
                    ? 'bg-surface-container-lowest text-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">account_balance</span>
                <span>Bank Transfer</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setRepaymentChannel('cash');
                setPaymentMethod('cash');
              }}
              className={`flex-1 py-1.5 px-3 rounded-lg font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                repaymentChannel === 'cash'
                  ? 'bg-surface-container-lowest text-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">payments</span>
              <span>Cash / Other</span>
            </button>
          </div>

          {/* UPI Channel Details */}
          {repaymentChannel === 'upi' && hasUpi && (
            <div className="p-4 rounded-2xl bg-surface-container-low border border-outline-variant/30 space-y-3.5">
              {/* QR vs App sub-tabs */}
              <div className="flex justify-between items-center">
                <div className="flex bg-surface-container p-0.5 rounded-lg border border-outline-variant/20">
                  <button
                    type="button"
                    onClick={() => setUpiViewTab('qr')}
                    className={`py-1 px-2.5 rounded-md text-xs font-mono font-bold transition-all cursor-pointer ${
                      upiViewTab === 'qr'
                        ? 'bg-surface-container-lowest text-primary shadow-xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Scan QR
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpiViewTab('app')}
                    className={`py-1 px-2.5 rounded-md text-xs font-mono font-bold transition-all cursor-pointer ${
                      upiViewTab === 'app'
                        ? 'bg-surface-container-lowest text-primary shadow-xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Open UPI App
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => copyToClipboard(person.upi_id || '', 'vpa')}
                  className="font-mono text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {copiedField === 'vpa' ? 'check' : 'content_copy'}
                  </span>
                  <span>{copiedField === 'vpa' ? 'Copied VPA!' : 'Copy UPI ID'}</span>
                </button>
              </div>

              {/* Dynamic QR Code View */}
              {upiViewTab === 'qr' && (
                <div className="flex flex-col items-center justify-center py-2 space-y-2">
                  <div className="p-3 bg-white rounded-2xl shadow-sm border border-neutral-200 inline-block">
                    {generatingQr || !qrCodeDataUrl ? (
                      <div className="w-[180px] h-[180px] flex items-center justify-center font-mono text-xs text-neutral-400">
                        Generating QR...
                      </div>
                    ) : (
                      <img
                        src={qrCodeDataUrl}
                        alt="UPI Payment QR Code"
                        className="w-[180px] h-[180px] block"
                      />
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-on-surface-variant text-center">
                    Scan with Slice, GPay, PhonePe, Paytm, or BHIM to pay{' '}
                    <span className="font-bold text-on-surface">
                      {formatCurrency(amount > 0 ? amount : maxPayable, currency)}
                    </span>
                  </p>
                </div>
              )}

              {/* App links view */}
              {upiViewTab === 'app' && (
                <div className="space-y-2 pt-1">
                  <div className="text-[11px] font-mono text-on-surface-variant">
                    Tap to open your preferred payment app:
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {sortedApps.map((app) => {
                      const isUserPreferred = userPreferredApp?.id === app.id;
                      const launchUrl = upiLink;
                      return (
                        <a
                          key={app.id}
                          href={launchUrl || '#'}
                          onClick={(e) => handleLaunchApp(e, app.id, app.name)}
                          className={`p-2.5 rounded-xl border flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer ${
                            isUserPreferred
                              ? 'border-primary/60 bg-primary/10 text-primary'
                              : 'border-outline-variant/30 bg-surface-container hover:border-outline-variant/60 text-on-surface'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {app.id === 'slice' ? 'credit_card' : 'smartphone'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-xs font-bold truncate">{app.name}</div>
                            {isUserPreferred && (
                              <span className="text-[9px] font-mono uppercase text-primary font-bold">
                                Preferred
                              </span>
                            )}
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bank Transfer Details */}
          {repaymentChannel === 'bank' && hasBank && (
            <div className="p-4 rounded-2xl bg-surface-container-low border border-outline-variant/30 space-y-3 font-mono text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-outline-variant/20">
                <span className="text-on-surface-variant font-semibold">Bank Account Details</span>
                {person?.bank_ifsc && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
                    IFSC: {person.bank_ifsc}
                  </span>
                )}
              </div>

              {person?.bank_account_holder_name && (
                <div className="flex justify-between items-center">
                  <span className="text-on-surface-variant">Account Holder:</span>
                  <span className="font-bold text-on-surface">{person.bank_account_holder_name}</span>
                </div>
              )}

              {person?.bank_name && (
                <div className="flex justify-between items-center">
                  <span className="text-on-surface-variant">Bank Name:</span>
                  <span className="font-bold text-on-surface">{person.bank_name}</span>
                </div>
              )}

              {person?.bank_account_number && (
                <div className="flex justify-between items-center">
                  <span className="text-on-surface-variant">Account Number:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-on-surface font-mono">
                      {showMaskedAccount ? person.bank_account_number : maskBankAccount(person.bank_account_number)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowMaskedAccount(!showMaskedAccount)}
                      className="text-on-surface-variant hover:text-on-surface p-1"
                      title={showMaskedAccount ? 'Mask account' : 'Reveal account'}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {showMaskedAccount ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(person.bank_account_number || '', 'acc')}
                      className="text-primary hover:underline text-[11px] font-bold"
                    >
                      {copiedField === 'acc' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              {person?.bank_ifsc && (
                <div className="flex justify-between items-center">
                  <span className="text-on-surface-variant">IFSC Code:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-on-surface">{person.bank_ifsc}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(person.bank_ifsc || '', 'ifsc')}
                      className="text-primary hover:underline text-[11px] font-bold"
                    >
                      {copiedField === 'ifsc' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 5. Verification Fields (UTR / Reference & Note) */}
        <div className="space-y-3 pt-1 border-t border-outline-variant/20">
          <div>
            <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant font-semibold mb-1.5">
              UTR / Transaction Reference (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. UPI 12-digit Ref or Bank UTR"
              value={transactionRef}
              onChange={(e) => setTransactionRef(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/40 bg-surface text-on-surface text-base md:text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
            />
          </div>

          <div>
            <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant font-semibold mb-1.5">
              Payment Note (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Settle balance via Slice"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/40 bg-surface text-on-surface text-base md:text-sm font-body-md outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
            />
          </div>
        </div>

        {/* Submit Actions */}
        <div className="pt-2 border-t border-outline-variant/20 flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl border border-outline-variant/30 font-mono text-xs font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || amount <= 0 || isCurrentUserIsolated}
            className="flex-2 py-3 px-5 rounded-xl bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-95 shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[18px]">
              {loading ? 'sync' : 'check_circle'}
            </span>
            <span>
              {loading
                ? 'Recording...'
                : `Confirm Repayment (${formatCurrency(amount || 0, currency)})`}
            </span>
          </button>
        </div>

        <p className="text-[11px] font-mono text-on-surface-variant text-center">
          The counterparty will receive a verification request in their Notifications center to confirm this payment.
        </p>
      </form>
    </Modal>
  );
}
