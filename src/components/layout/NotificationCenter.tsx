'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from '../ui/Avatar';
import { formatCurrency } from '@/lib/utils/currency';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendWebNotification,
} from '@/lib/utils/web-notifications';
import { formatPaymentMethodDisplay } from '@/lib/utils/upi-link';
import { respondToDebtAgreement } from '@/lib/utils/debt-acceptance';
import { invalidateCooldownCache } from '@/lib/utils/debt-cooldown';
import { parseSplitDetails, getCleanDebtNotes } from '@/lib/utils/split-bills';

interface IncomingDebtRequest {
  id: string;
  principal: number;
  currency: string;
  interest_type: string;
  interest_rate: number | null;
  notes: string | null;
  created_at: string;
  lender_id: string;
  borrower_id: string;
  counterparty: {
    id: string;
    full_name: string;
    email: string;
    avatar_url: string | null;
  };
  direction: 'lent' | 'borrowed'; // from perspective of current user
}

interface IncomingContactRequest {
  id: string;
  created_at: string;
  sender: {
    id: string;
    full_name: string;
    email: string;
    avatar_url: string | null;
  };
}

interface PendingRepayment {
  id: string;
  debt_id: string;
  amount: number;
  currency: string;
  note: string | null;
  payment_method?: string | null;
  transaction_ref?: string | null;
  created_at: string;
  payer: {
    id: string;
    full_name: string;
    email: string;
    avatar_url: string | null;
  };
}

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'debts' | 'contacts' | 'repayments'>('all');
  const [debtRequests, setDebtRequests] = useState<IncomingDebtRequest[]>([]);
  const [contactRequests, setContactRequests] = useState<IncomingContactRequest[]>([]);
  const [pendingRepayments, setPendingRepayments] = useState<PendingRepayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [webPermission, setWebPermission] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('default');

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isFetchingRef = useRef(false);
  const channelNameRef = useRef(`notification-center-${Math.random().toString(36).substring(2, 8)}`);
  const supabase = createClient();

  useEffect(() => {
    setWebPermission(getNotificationPermission());
  }, []);

  const handleEnableWebNotifications = async () => {
    const granted = await requestNotificationPermission();
    setWebPermission(granted ? 'granted' : 'denied');
    if (granted) {
      sendWebNotification('Notifications Enabled!', {
        body: 'You will now receive instant desktop alerts for repayment requests and debt syncs.',
      });
    }
  };

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) return;

      // 1. Fetch incoming debt agreements awaiting approval
      const { data: debts } = await supabase
        .from('debts')
        .select(`
          id, principal, currency, interest_type, interest_rate, notes, created_at,
          lender_id, borrower_id, created_by,
          lender:profiles!debts_lender_id_fkey(id, full_name, email, avatar_url),
          borrower:profiles!debts_borrower_id_fkey(id, full_name, email, avatar_url)
        `)
        .eq('status', 'pending')
        .neq('created_by', user.id)
        .or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (debts) {
        const formattedDebts: IncomingDebtRequest[] = debts.map((d: any) => {
          const isLender = d.lender_id === user.id;
          const other = isLender ? d.borrower : d.lender;
          return {
            id: d.id,
            principal: Number(d.principal) || 0,
            currency: d.currency || 'inr',
            interest_type: d.interest_type,
            interest_rate: d.interest_rate,
            notes: d.notes,
            created_at: d.created_at,
            lender_id: d.lender_id,
            borrower_id: d.borrower_id,
            counterparty: {
              id: other?.id || '',
              full_name: other?.full_name || other?.email || 'Counterparty',
              email: other?.email || '',
              avatar_url: other?.avatar_url || null,
            },
            direction: isLender ? 'lent' : 'borrowed',
          };
        });
        setDebtRequests(formattedDebts);
      }

      // 2. Fetch incoming contact connection requests
      try {
        const { data: contactReqs } = await supabase
          .from('contact_requests')
          .select(`
            id, created_at,
            sender:profiles!contact_requests_sender_id_fkey(id, full_name, email, avatar_url)
          `)
          .eq('receiver_id', user.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (contactReqs) {
          const formattedContacts: IncomingContactRequest[] = contactReqs.map((c: any) => ({
            id: c.id,
            created_at: c.created_at,
            sender: {
              id: c.sender?.id || '',
              full_name: c.sender?.full_name || c.sender?.email || 'Someone on DebtSync',
              email: c.sender?.email || '',
              avatar_url: c.sender?.avatar_url || null,
            },
          }));
          setContactRequests(formattedContacts);
        }
      } catch (_) {
        // Table may be migrating
      }

      // 3. Fetch repayments awaiting lender verification (active debts only)
      try {
        const { data: myLentDebts } = await supabase
          .from('debts')
          .select('id')
          .eq('lender_id', user.id)
          .eq('status', 'active');

        const debtIds = ((myLentDebts as any[]) || []).map((d: any) => d.id);

        if (debtIds.length > 0) {
          const { data: unverifiedPayments } = await supabase
            .from('payments')
            .select(`
              id, debt_id, amount, currency, note, payment_method, transaction_ref, created_at, paid_by, verified_at,
              payer:profiles!payments_paid_by_fkey(id, full_name, email, avatar_url)
            `)
            .in('debt_id', debtIds)
            .eq('is_verified', false)
            .order('created_at', { ascending: false });

          if (unverifiedPayments) {
            const formattedPayments: PendingRepayment[] = unverifiedPayments
              .filter((p: any) => {
                const isDisputed =
                  p.status === 'disputed' ||
                  p.verified_at != null ||
                  (typeof p.note === 'string' && p.note.includes('[DISPUTED]'));
                return !isDisputed;
              })
              .map((p: any) => ({
                id: p.id,
                debt_id: p.debt_id,
                amount: Number(p.amount) || 0,
                currency: p.currency || 'inr',
                note: p.note,
                payment_method: p.payment_method || null,
                transaction_ref: p.transaction_ref || null,
                created_at: p.created_at,
                payer: {
                  id: p.payer?.id || '',
                  full_name: p.payer?.full_name || p.payer?.email || 'Borrower',
                  email: p.payer?.email || '',
                  avatar_url: p.payer?.avatar_url || null,
                },
              }));
            setPendingRepayments(formattedPayments);
          }
        } else {
          setPendingRepayments([]);
        }
      } catch (_) {}
    } catch (err) {
      console.error('Error loading notifications:', err);
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchNotifications();

    const handleRefresh = () => fetchNotifications();
    window.addEventListener('debtsync:refresh', handleRefresh);

    const channel = supabase
      .channel(channelNameRef.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'debts' }, (payload: any) => {
        fetchNotifications();
        if (payload.eventType === 'INSERT') {
          sendWebNotification('New Debt Request', {
            body: 'A counterparty has logged a debt request awaiting your review.',
            tag: `debt-${payload.new?.id}`,
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, (payload: any) => {
        fetchNotifications();
        if (payload.eventType === 'INSERT') {
          sendWebNotification('Repayment Reported', {
            body: 'A borrower reported a repayment awaiting your verification.',
            tag: `payment-${payload.new?.id}`,
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_requests' }, (payload: any) => {
        fetchNotifications();
        if (payload.eventType === 'INSERT') {
          sendWebNotification('New Contact Request', {
            body: 'You received a new contact connection request.',
            tag: `contact-${payload.new?.id}`,
          });
        }
      })
      .subscribe();

    return () => {
      window.removeEventListener('debtsync:refresh', handleRefresh);
      supabase.removeChannel(channel);
    };
  }, [fetchNotifications]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleAcceptDebt = async (debtId: string, decision: 'active' | 'declined') => {
    setActionLoadingId(debtId);
    try {
      await respondToDebtAgreement(supabase, debtId, decision);
      await fetchNotifications();
    } catch (err) {
      console.error('Error responding to debt:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRespondContact = async (requestId: string, decision: 'accepted' | 'declined') => {
    setActionLoadingId(requestId);
    try {
      let success = false;
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('respond_to_contact_request', {
          p_request_id: requestId,
          p_decision: decision,
        });
        if (!rpcErr && rpcRes && rpcRes.success) success = true;
      } catch (_) {}

      if (!success) {
        const { data: reqRow } = await supabase
          .from('contact_requests')
          .select('sender_id, receiver_id')
          .eq('id', requestId)
          .single();

        await supabase
          .from('contact_requests')
          .update({
            status: decision,
            responded_at: new Date().toISOString(),
          })
          .eq('id', requestId);

        if (decision === 'accepted' && reqRow) {
          await supabase.from('contacts').upsert([
            { owner_id: reqRow.sender_id, contact_id: reqRow.receiver_id },
            { owner_id: reqRow.receiver_id, contact_id: reqRow.sender_id },
          ], { onConflict: 'owner_id,contact_id' });
        }
      }

      invalidateCooldownCache();
      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      await fetchNotifications();
    } catch (err) {
      console.error('Error responding to contact request:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleVerifyRepayment = async (paymentId: string, decision: 'accepted' | 'declined') => {
    setActionLoadingId(paymentId);
    try {
      let success = false;
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('verify_repayment', {
          p_payment_id: paymentId,
          p_decision: decision,
        });
        if (!rpcErr && rpcRes && rpcRes.success) success = true;
      } catch (_) {}

      if (!success) {
        const { data: pRec } = await supabase.from('payments').select('debt_id, amount, note').eq('id', paymentId).single();

        if (decision === 'accepted') {
          await supabase
            .from('payments')
            .update({
              is_verified: true,
              verified_at: new Date().toISOString(),
            })
            .eq('id', paymentId);

          // Check if debt balance is cleared
          if (pRec?.debt_id) {
            const { data: allP } = await supabase.from('payments').select('amount').eq('debt_id', pRec.debt_id).eq('is_verified', true);
            const { data: dRec } = await supabase.from('debts').select('principal').eq('id', pRec.debt_id).single();
            const totalPaid = (allP || []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
            if (dRec && totalPaid >= Number(dRec.principal) - 0.01) {
              await supabase.from('debts').update({ status: 'settled', settled_at: new Date().toISOString() }).eq('id', pRec.debt_id);
              // Auto-purge other lingering unverified payments for this settled debt
              await supabase.from('payments').delete().eq('debt_id', pRec.debt_id).eq('is_verified', false);
            }
          }
        } else {
          // Lender declined / disputed payment
          const existingNote = pRec?.note || '';
          const disputedNote = existingNote.includes('[DISPUTED]')
            ? existingNote
            : (existingNote ? `${existingNote} [DISPUTED]` : 'Disputed by lender [DISPUTED]');

          await supabase
            .from('payments')
            .update({
              is_verified: false,
              verified_at: new Date().toISOString(),
              note: disputedNote,
            })
            .eq('id', paymentId);

          const user = await getCurrentUserFast(supabase);
          if (pRec?.debt_id && user?.id) {
            await supabase.from('activity_log').insert({
              user_id: user.id,
              debt_id: pRec.debt_id,
              action: 'payment_disputed',
              details: {
                amount: pRec.amount,
                note: disputedNote,
                disputed_by: user.id,
              },
            });
          }
        }
      }

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      await fetchNotifications();
    } catch (err) {
      console.error('Error verifying repayment:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const totalNotifications = debtRequests.length + contactRequests.length + pendingRepayments.length;

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/20 active:scale-90"
        title="Notifications & pending requests"
        aria-label="Notifications"
      >
        <span className="material-symbols-outlined text-[20px]">
          {totalNotifications > 0 ? 'notifications_active' : 'notifications'}
        </span>
        {totalNotifications > 0 && (
          <span className="absolute top-0.5 right-0.5 flex items-center justify-center min-w-[16px] h-[16px] px-0.5 bg-primary text-on-primary text-[9px] font-mono font-bold rounded-full shadow-sm animate-pulse">
            {totalNotifications}
          </span>
        )}
      </button>

      {/* Floating Notification Pane */}
      {isOpen && (
        <div
          ref={containerRef}
          className="fixed left-[max(0.75rem,env(safe-area-inset-left,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[calc(3.5rem+env(safe-area-inset-top,0px)+0.5rem)] md:left-auto md:right-0 md:top-12 md:w-96 bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[80vh]"
        >
          {/* Header */}
          <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between bg-surface-container-low">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">notifications</span>
              <h3 className="font-heading font-bold text-sm text-on-surface">
                Notifications
              </h3>
              {totalNotifications > 0 && (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {totalNotifications} new
                </span>
              )}
            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {/* Filter Pills */}
          <div className="flex bg-surface-container p-1 border-b border-outline-variant/10 overflow-x-auto text-[11px] font-mono font-semibold">
            <button
              onClick={() => setActiveTab('all')}
              className={`flex-1 py-1 px-2 rounded-lg transition-all ${
                activeTab === 'all'
                  ? 'bg-surface-container-lowest text-primary shadow-xs font-bold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              All ({totalNotifications})
            </button>
            <button
              onClick={() => setActiveTab('debts')}
              className={`flex-1 py-1 px-2 rounded-lg transition-all ${
                activeTab === 'debts'
                  ? 'bg-surface-container-lowest text-primary shadow-xs font-bold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Debts ({debtRequests.length})
            </button>
            <button
              onClick={() => setActiveTab('contacts')}
              className={`flex-1 py-1 px-2 rounded-lg transition-all ${
                activeTab === 'contacts'
                  ? 'bg-surface-container-lowest text-primary shadow-xs font-bold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Contacts ({contactRequests.length})
            </button>
            <button
              onClick={() => setActiveTab('repayments')}
              className={`flex-1 py-1 px-2 rounded-lg transition-all ${
                activeTab === 'repayments'
                  ? 'bg-surface-container-lowest text-primary shadow-xs font-bold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Verify ({pendingRepayments.length})
            </button>
          </div>

          {/* Web Desktop Notifications Prompt */}
          {webPermission === 'default' && (
            <div className="p-2.5 mx-3 mt-2 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between text-xs text-on-surface">
              <div className="flex items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-primary text-[18px] shrink-0">
                  notifications_active
                </span>
                <span className="truncate text-[11px] leading-tight">
                  Turn on desktop alerts for new repayment and sync requests
                </span>
              </div>
              <button
                type="button"
                onClick={handleEnableWebNotifications}
                className="px-2.5 py-1 rounded-lg bg-primary text-on-primary text-[11px] font-mono font-bold hover:brightness-110 shrink-0 ml-2 shadow-xs"
              >
                Enable
              </button>
            </div>
          )}

          {/* List Content */}
          <div className="overflow-y-auto p-3 space-y-3 flex-1 divide-y divide-outline-variant/10">
            {totalNotifications === 0 ? (
              <div className="py-12 text-center">
                <div className="w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center mx-auto mb-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[24px]">notifications_paused</span>
                </div>
                <p className="font-heading font-semibold text-sm text-on-surface">All caught up!</p>
                <p className="font-mono text-xs text-on-surface-variant mt-0.5">
                  No pending lending requests or verifications
                </p>
              </div>
            ) : null}

            {/* Debt Requests */}
            {(activeTab === 'all' || activeTab === 'debts') && debtRequests.length > 0 && (
              <div className="space-y-2.5 pt-1">
                <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-on-surface-variant px-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px] text-amber-500">payments</span>
                  <span>Lending &amp; Debt Requests ({debtRequests.length})</span>
                </div>

                {debtRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-3 rounded-xl bg-surface-container-low border border-amber-500/20 space-y-2.5 shadow-xs"
                  >
                    <Link
                      href={`/directory/detail?id=${req.counterparty?.id || req.id}`}
                      onClick={() => setIsOpen(false)}
                      className="flex items-start gap-2.5 hover:opacity-90 group cursor-pointer"
                      title={`View ${req.counterparty.full_name}'s contact ledger`}
                    >
                      <Avatar
                        src={req.counterparty.avatar_url}
                        name={req.counterparty.full_name}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-on-surface group-hover:text-primary group-hover:underline transition-colors truncate">
                          {req.counterparty.full_name}
                        </p>
                        <p className="font-mono text-[11px] text-on-surface-variant mt-0.5">
                          {req.direction === 'lent' ? 'Sent you a loan of' : 'Requests to borrow'}{' '}
                          <strong className="text-on-surface font-bold">
                            {formatCurrency(req.principal, req.currency)}
                          </strong>
                        </p>
                        {(() => {
                          const split = parseSplitDetails(req);
                          const cleanNote = getCleanDebtNotes(req.notes);
                          return (
                            <>
                              {split && (
                                <div className="mt-1">
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/25 text-[10px] font-mono font-bold">
                                    <span className="material-symbols-outlined text-[11px]">call_split</span>
                                    <span>Split: {split.title}</span>
                                  </span>
                                </div>
                              )}
                              {cleanNote && (
                                <p className="text-[11px] text-on-surface-variant/80 italic mt-1 line-clamp-2">
                                  &quot;{cleanNote}&quot;
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </Link>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-outline-variant/15">
                      <button
                        type="button"
                        disabled={actionLoadingId === req.id}
                        onClick={() => handleAcceptDebt(req.id, 'declined')}
                        className="px-2.5 py-1 rounded-lg border border-error/30 text-error font-mono text-xs font-bold hover:bg-error/10 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        disabled={actionLoadingId === req.id}
                        onClick={() => handleAcceptDebt(req.id, 'active')}
                        className="px-3 py-1 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[14px]">check</span>
                        <span>Accept</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Contact Connection Requests */}
            {(activeTab === 'all' || activeTab === 'contacts') && contactRequests.length > 0 && (
              <div className="space-y-2.5 pt-3">
                <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-on-surface-variant px-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px] text-primary">person_add</span>
                  <span>Contact Nudges ({contactRequests.length})</span>
                </div>

                {contactRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-3 rounded-xl bg-surface-container-low border border-primary/20 space-y-2.5 shadow-xs"
                  >
                    <Link
                      href={`/directory/detail?id=${req.sender?.id || req.id}`}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-2.5 hover:opacity-90 group cursor-pointer"
                      title={`View ${req.sender.full_name}'s contact ledger`}
                    >
                      <Avatar
                        src={req.sender.avatar_url}
                        name={req.sender.full_name}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-on-surface group-hover:text-primary group-hover:underline transition-colors truncate">
                          {req.sender.full_name}
                        </p>
                        <p className="font-mono text-[11px] text-on-surface-variant">
                          Wants to add you to their DebtSync directory
                        </p>
                      </div>
                    </Link>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-outline-variant/15">
                      <button
                        type="button"
                        disabled={actionLoadingId === req.id}
                        onClick={() => handleRespondContact(req.id, 'declined')}
                        className="px-2.5 py-1 rounded-lg border border-outline-variant/40 text-on-surface-variant font-mono text-xs font-bold hover:bg-surface-container transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        Ignore
                      </button>
                      <button
                        type="button"
                        disabled={actionLoadingId === req.id}
                        onClick={() => handleRespondContact(req.id, 'accepted')}
                        className="px-3 py-1 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[14px]">person_check</span>
                        <span>Connect</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Repayment Verifications */}
            {(activeTab === 'all' || activeTab === 'repayments') && pendingRepayments.length > 0 && (
              <div className="space-y-2.5 pt-3">
                <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-on-surface-variant px-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px] text-emerald-500">verified</span>
                  <span>Repayments Awaiting Verification ({pendingRepayments.length})</span>
                </div>

                {pendingRepayments.map((rep) => (
                  <div
                    key={rep.id}
                    className="p-3 rounded-xl bg-surface-container-low border border-emerald-500/20 space-y-2.5 shadow-xs"
                  >
                    <div className="flex items-start gap-2.5">
                      <Avatar
                        src={rep.payer.avatar_url}
                        name={rep.payer.full_name}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-on-surface truncate">
                          {rep.payer.full_name}
                        </p>
                        <p className="font-mono text-[11px] text-on-surface-variant mt-0.5">
                          Reported repayment of{' '}
                          <strong className="text-emerald-600 dark:text-emerald-400 font-bold">
                            {formatCurrency(rep.amount, rep.currency)}
                          </strong>
                        </p>
                        {rep.note && (
                          <p className="text-[11px] text-on-surface-variant/80 italic mt-1 line-clamp-2">
                            &quot;{rep.note}&quot;
                          </p>
                        )}

                        {rep.transaction_ref && (() => {
                          const disp = formatPaymentMethodDisplay(rep.payment_method, rep.transaction_ref);
                          return (
                            <div className="mt-2 p-2 rounded-lg bg-surface-container border border-outline-variant/25 flex items-center justify-between text-[11px] font-mono">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="material-symbols-outlined text-[14px] text-primary shrink-0">
                                  {disp.icon}
                                </span>
                                <span className="text-on-surface-variant font-semibold">
                                  {disp.fullLabel} Ref:
                                </span>
                                <span className="font-bold text-on-surface truncate select-all">
                                  {rep.transaction_ref}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  if (rep.transaction_ref) {
                                    navigator.clipboard.writeText(rep.transaction_ref);
                                  }
                                }}
                                className="text-primary hover:underline shrink-0 ml-1.5 flex items-center gap-0.5 text-[10px] font-bold cursor-pointer"
                                title="Copy reference ID to check in banking app"
                              >
                                <span className="material-symbols-outlined text-[13px]">content_copy</span>
                                <span>Copy</span>
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-outline-variant/15">
                      <button
                        type="button"
                        disabled={actionLoadingId === rep.id}
                        onClick={() => handleVerifyRepayment(rep.id, 'declined')}
                        className="px-2.5 py-1 rounded-lg border border-error/30 text-error font-mono text-xs font-bold hover:bg-error/10 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        Dispute
                      </button>
                      <button
                        type="button"
                        disabled={actionLoadingId === rep.id}
                        onClick={() => handleVerifyRepayment(rep.id, 'accepted')}
                        className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[14px]">done_all</span>
                        <span>Verify Receipt</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
