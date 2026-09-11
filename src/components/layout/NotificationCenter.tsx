'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from '../ui/Avatar';
import { formatCurrency } from '@/lib/utils/currency';

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

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const supabase = createClient();

  const fetchNotifications = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
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

      // 3. Fetch repayments awaiting lender verification
      try {
        const { data: myLentDebts } = await supabase
          .from('debts')
          .select('id')
          .eq('lender_id', user.id);

        const debtIds = (myLentDebts || []).map((d) => d.id);

        if (debtIds.length > 0) {
          const { data: unverifiedPayments } = await supabase
            .from('payments')
            .select(`
              id, debt_id, amount, currency, note, created_at, paid_by,
              payer:profiles!payments_paid_by_fkey(id, full_name, email, avatar_url)
            `)
            .in('debt_id', debtIds)
            .eq('is_verified', false)
            .order('created_at', { ascending: false });

          if (unverifiedPayments) {
            const formattedPayments: PendingRepayment[] = unverifiedPayments.map((p: any) => ({
              id: p.id,
              debt_id: p.debt_id,
              amount: Number(p.amount) || 0,
              currency: p.currency || 'inr',
              note: p.note,
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
        }
      } catch (_) {}
    } catch (err) {
      console.error('Error loading notifications:', err);
    }
  }, [supabase]);

  useEffect(() => {
    fetchNotifications();

    const handleRefresh = () => fetchNotifications();
    window.addEventListener('debtsync:refresh', handleRefresh);

    const channel = supabase
      .channel('notification-center-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'debts' }, fetchNotifications)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, fetchNotifications)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_requests' }, fetchNotifications)
      .subscribe();

    return () => {
      window.removeEventListener('debtsync:refresh', handleRefresh);
      supabase.removeChannel(channel);
    };
  }, [fetchNotifications, supabase]);

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
      let success = false;
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('accept_debt', {
          p_debt_id: debtId,
          p_decision: decision,
        });
        if (!rpcErr && rpcRes && rpcRes.success) success = true;
      } catch (_) {}

      if (!success) {
        await supabase
          .from('debts')
          .update({
            status: decision,
            accepted_at: decision === 'active' ? new Date().toISOString() : null,
          })
          .eq('id', debtId);
      }

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
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
        await supabase
          .from('contact_requests')
          .update({
            status: decision,
            responded_at: new Date().toISOString(),
          })
          .eq('id', requestId);
      }

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
        await supabase
          .from('payments')
          .update({
            is_verified: decision === 'accepted',
            verified_at: new Date().toISOString(),
          })
          .eq('id', paymentId);
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
        className="relative p-2 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20"
        title="Notifications & pending requests"
        aria-label="Notifications"
      >
        <span className="material-symbols-outlined text-[22px]">
          {totalNotifications > 0 ? 'notifications_active' : 'notifications'}
        </span>
        {totalNotifications > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-primary text-on-primary text-[10px] font-mono font-bold rounded-full shadow-sm animate-pulse">
            {totalNotifications}
          </span>
        )}
      </button>

      {/* Floating Notification Pane */}
      {isOpen && (
        <div
          ref={containerRef}
          className="fixed inset-x-3 top-16 md:absolute md:inset-auto md:right-0 md:top-12 md:w-96 bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[80vh]"
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
                    <div className="flex items-start gap-2.5">
                      <Avatar
                        src={req.counterparty.avatar_url}
                        name={req.counterparty.full_name}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-on-surface truncate">
                          {req.counterparty.full_name}
                        </p>
                        <p className="font-mono text-[11px] text-on-surface-variant mt-0.5">
                          {req.direction === 'lent' ? 'Sent you a loan of' : 'Requests to borrow'}{' '}
                          <strong className="text-on-surface font-bold">
                            {formatCurrency(req.principal, req.currency)}
                          </strong>
                        </p>
                        {req.notes && (
                          <p className="text-[11px] text-on-surface-variant/80 italic mt-1 line-clamp-2">
                            &quot;{req.notes}&quot;
                          </p>
                        )}
                      </div>
                    </div>

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
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        src={req.sender.avatar_url}
                        name={req.sender.full_name}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-on-surface truncate">
                          {req.sender.full_name}
                        </p>
                        <p className="font-mono text-[11px] text-on-surface-variant">
                          Wants to add you to their DebtSync directory
                        </p>
                      </div>
                    </div>

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
