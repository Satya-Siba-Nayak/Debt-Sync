'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment, Profile, ActivityLogEntry } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';
import { calculateDebtBalance, round2 } from '@/lib/utils/interest';
import { calculateTrustScore, TrustScoreBreakdown } from '@/lib/utils/trust-score';
import {
  PAYMENT_METHOD_LABELS,
  isUPIMethod,
  PRIMARY_PAYMENT_METHODS,
  formatPaymentMethodDisplay,
  detectUPIApp,
} from '@/lib/utils/upi-link';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { getCurrentUserFast } from '@/lib/utils/auth-session';

export type AdminTab = 'overview' | 'users' | 'transactions' | 'analytics';

export interface TelemetryEvent {
  id: string;
  timestamp: string; // ISO
  relativeTime: string;
  table: 'debts' | 'payments' | 'profiles' | 'activity_log';
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  title: string;
  description: string;
  badgeClass: string;
  icon: string;
  payload: any;
}

export default function AdminDashboardPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [currency, setCurrency] = useState('inr');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Raw platform records
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [allDebts, setAllDebts] = useState<Debt[]>([]);
  const [allPayments, setAllPayments] = useState<Payment[]>([]);
  const [allLogs, setAllLogs] = useState<ActivityLogEntry[]>([]);

  // Live Stream / Telemetry state
  const [liveEvents, setLiveEvents] = useState<TelemetryEvent[]>([]);
  const [isLivePaused, setIsLivePaused] = useState(false);
  const [isWebSocketActive, setIsWebSocketActive] = useState(false);
  const [liveFilter, setLiveFilter] = useState<'all' | 'payments' | 'debts' | 'profiles' | 'admin'>('all');
  const [selectedTelemetryEvent, setSelectedTelemetryEvent] = useState<TelemetryEvent | null>(null);
  const livePausedRef = useRef(isLivePaused);
  livePausedRef.current = isLivePaused;

  // Filtering states for Users tab
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<'all' | 'registered' | 'ghost' | 'isolated' | 'active_debts'>('all');
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);

  const [isolationTarget, setIsolationTarget] = useState<Profile | null>(null);
  const [isolationReasonInput, setIsolationReasonInput] = useState('');
  const [purgeTarget, setPurgeTarget] = useState<Profile | null>(null);
  const [purgeForceCascade, setPurgeForceCascade] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filtering states for Transactions tab
  const [txnSearch, setTxnSearch] = useState('');
  const [txnStatusFilter, setTxnStatusFilter] = useState<'all' | 'active' | 'settled' | 'pending' | 'disputed'>('all');
  const [txnMethodFilter, setTxnMethodFilter] = useState<string>('all');
  const [selectedDebtDetail, setSelectedDebtDetail] = useState<Debt | null>(null);

  // URL synchronization for direct tab linking & external tab dispatching
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab') as AdminTab | 'live' | null;
      if (tabParam === 'live' || tabParam === 'overview') {
        setActiveTab('overview');
      } else if (tabParam && ['users', 'transactions', 'analytics'].includes(tabParam)) {
        setActiveTab(tabParam as AdminTab);
      }

      const handleTabEvent = (e: any) => {
        if (e.detail?.tab) {
          const t = e.detail.tab;
          if (t === 'live' || t === 'overview') setActiveTab('overview');
          else if (['users', 'transactions', 'analytics'].includes(t)) setActiveTab(t);
        }
      };
      window.addEventListener('debtsync:admin_tab_changed', handleTabEvent);
      return () => window.removeEventListener('debtsync:admin_tab_changed', handleTabEvent);
    }
  }, []);

  const handleSelectTab = (tab: AdminTab) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (tab === 'overview') {
        url.searchParams.delete('tab');
      } else {
        url.searchParams.set('tab', tab);
      }
      window.history.replaceState({}, '', url.toString());
      window.dispatchEvent(new CustomEvent('debtsync:admin_tab_changed', { detail: { tab } }));
    }
  };

  const addTelemetryEvent = useCallback((event: Omit<TelemetryEvent, 'id' | 'timestamp' | 'relativeTime'>) => {
    const now = new Date();
    const newEvt: TelemetryEvent = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(6)}`,
      timestamp: now.toISOString(),
      relativeTime: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };

    setLiveEvents((prev) => [newEvt, ...prev].slice(0, 100));
  }, []);

  const fetchAdminData = useCallback(async (isSilent: boolean = false) => {
    if (!isSilent) setLoading(true);
    try {
      const user = await getCurrentUserFast(supabase);
      if (user) {
        setCurrentUserId(user.id);
        const { data: settings } = await supabase
          .from('user_settings')
          .select('default_currency')
          .eq('user_id', user.id)
          .single();
        if (settings?.default_currency) setCurrency(settings.default_currency);
      }

      // Fetch all platform datasets
      const [profilesRes, debtsRes, paymentsRes, logsRes] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase
          .from('debts')
          .select(`
            *,
            lender:profiles!debts_lender_id_fkey(*),
            borrower:profiles!debts_borrower_id_fkey(*)
          `)
          .order('created_at', { ascending: false }),
        supabase
          .from('payments')
          .select(`
            *,
            payer:profiles!payments_paid_by_fkey(*),
            debt:debts(*)
          `)
          .order('created_at', { ascending: false }),
        supabase
          .from('activity_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      if (profilesRes.data) setAllProfiles(profilesRes.data as Profile[]);
      if (debtsRes.data) setAllDebts(debtsRes.data as Debt[]);
      if (paymentsRes.data) setAllPayments(paymentsRes.data as Payment[]);
      if (logsRes.data) {
        const fetchedLogs = logsRes.data as ActivityLogEntry[];
        setAllLogs(fetchedLogs);
        setLiveEvents((prev) => {
          if (prev.length > 0) return prev;
          return fetchedLogs.slice(0, 30).map((l) => {
            const isAdmin = l.action.startsWith('ADMIN_');
            const actorName = (l.details as any)?.by_name || (l.details as any)?.actorName || 'User';
            const logDate = new Date(l.created_at);
            return {
              id: `hist_${l.id}`,
              timestamp: logDate.toISOString(),
              relativeTime: logDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              table: 'activity_log' as const,
              eventType: 'INSERT' as const,
              title: isAdmin
                ? `Admin: ${l.action.replace('ADMIN_', '').replace(/_/g, ' ')}`
                : `Action: ${l.action.replace(/_/g, ' ')}`,
              description: (l.details as any)?.target_email
                ? `Target: ${(l.details as any).target_email}`
                : (l.details as any)?.note || `Logged by ${actorName}`,
              badgeClass: isAdmin
                ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30'
                : 'bg-indigo-500/15 text-indigo-500 border-indigo-500/20',
              icon: isAdmin ? 'admin_panel_settings' : 'security',
              payload: l,
            };
          });
        });
      }
    } catch (err) {
      console.error('Error fetching admin data:', err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  // --- Real-Time Telemetry WebSocket Streaming ---
  useEffect(() => {
    const channelName = `admin_live_stream_${Math.random().toString(36).substring(7)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments' },
        (payload: any) => {
          const rec: any = payload.new || payload.old || {};
          const isInsert = payload.eventType === 'INSERT';
          addTelemetryEvent({
            table: 'payments',
            eventType: payload.eventType as any,
            title: isInsert ? `Payment Submitted: ${formatCurrency(rec.amount || 0, rec.currency || 'INR')}` : `Payment ${payload.eventType}`,
            description: `Payment ${rec.id?.substring(0, 8)}... via ${rec.payment_method || 'UPI'} ${rec.is_verified ? '(Verified)' : '(Pending)'}`,
            badgeClass: isInsert ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20' : 'bg-blue-500/15 text-blue-500 border-blue-500/20',
            icon: 'payments',
            payload,
          });
          if (!livePausedRef.current) fetchAdminData(true);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'debts' },
        (payload: any) => {
          const rec: any = payload.new || payload.old || {};
          const isInsert = payload.eventType === 'INSERT';
          addTelemetryEvent({
            table: 'debts',
            eventType: payload.eventType as any,
            title: isInsert ? `New Debt Contract: ${formatCurrency(rec.principal || 0, rec.currency || 'INR')}` : `Debt ${payload.eventType} (${rec.status})`,
            description: `Status: ${rec.status || 'pending'} • APR: ${rec.interest_rate || 0}% (${rec.interest_type || 'none'})`,
            badgeClass: rec.status === 'settled' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20' : rec.status === 'disputed' ? 'bg-red-500/15 text-red-500 border-red-500/20' : 'bg-indigo-500/15 text-indigo-500 border-indigo-500/20',
            icon: 'receipt_long',
            payload,
          });
          if (!livePausedRef.current) fetchAdminData(true);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        (payload: any) => {
          const rec: any = payload.new || payload.old || {};
          const isInsert = payload.eventType === 'INSERT';
          addTelemetryEvent({
            table: 'profiles',
            eventType: payload.eventType as any,
            title: isInsert ? `New User Registered: ${rec.full_name || rec.email}` : `Profile Modified: ${rec.full_name || rec.email}`,
            description: `${rec.email} ${rec.is_isolated ? '[ISOLATED]' : rec.is_verified ? '[VERIFIED]' : ''}`,
            badgeClass: rec.is_isolated ? 'bg-red-500/15 text-red-500 border-red-500/20' : 'bg-teal-500/15 text-teal-500 border-teal-500/20',
            icon: 'person',
            payload,
          });
          if (!livePausedRef.current) fetchAdminData(true);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_log' },
        (payload: any) => {
          const rec: any = payload.new || {};
          addTelemetryEvent({
            table: 'activity_log',
            eventType: 'INSERT',
            title: `System Action: ${rec.action || 'AUDIT'}`,
            description: `Triggered by ${rec.user_id?.substring(0, 8)}...`,
            badgeClass: 'bg-purple-500/15 text-purple-500 border-purple-500/20',
            icon: 'security',
            payload,
          });
        }
      )
      .subscribe((status: any) => {
        setIsWebSocketActive(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, addTelemetryEvent, fetchAdminData]);

  // --- Aggregate Platform Metrics ---
  const metrics = useMemo(() => {
    const totalUsers = allProfiles.length;
    const registeredUsers = allProfiles.filter((p) => !p.is_shadow).length;
    const ghostUsers = allProfiles.filter((p) => p.is_shadow).length;
    const isolatedUsers = allProfiles.filter((p) => p.is_isolated).length;

    let totalPrincipalVolume = 0;
    let totalOutstandingVolume = 0;
    let settledDebtsCount = 0;
    let activeDebtsCount = 0;
    let pendingDebtsCount = 0;
    let disputedCount = 0;

    for (const d of allDebts) {
      totalPrincipalVolume += Number(d.principal) || 0;
      if (d.status === 'settled') settledDebtsCount++;
      else if (d.status === 'active') activeDebtsCount++;
      else if (d.status === 'pending') pendingDebtsCount++;
      else if (d.status === 'disputed') disputedCount++;

      if (d.status !== 'settled' && d.status !== 'declined') {
        const debtPayments = allPayments.filter((p) => p.debt_id === d.id);
        const calc = calculateDebtBalance(d, debtPayments);
        totalOutstandingVolume += calc.currentBalance;
      }
    }

    const verifiedPayments = allPayments.filter((p) => p.is_verified);
    const totalRepaymentsVolume = verifiedPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const pendingPaymentsCount = allPayments.filter((p) => !p.is_verified).length;

    const disputedPaymentsCount = allPayments.filter(
      (p) => typeof p.note === 'string' && p.note.includes('[DISPUTED]')
    ).length;

    // Average trust score across platform using enhanced algorithm (filtering unscored users)
    const userScores = allProfiles.map((p) => {
      const uDebts = allDebts.filter((d) => d.lender_id === p.id || d.borrower_id === p.id);
      const uPayments = allPayments.filter((pm) => pm.paid_by === p.id);
      return calculateTrustScore(uDebts, uPayments, p.id, {
        isIsolated: p.is_isolated,
        isVerified: p.is_verified,
      }).score;
    });
    const scoredUsers = userScores.filter((s) => s > 0);
    const avgTrustScore =
      scoredUsers.length > 0 ? Math.round(scoredUsers.reduce((a, b) => a + b, 0) / scoredUsers.length) : -1;

    return {
      totalUsers,
      registeredUsers,
      ghostUsers,
      isolatedUsers,
      totalPrincipalVolume: round2(totalPrincipalVolume),
      totalOutstandingVolume: round2(totalOutstandingVolume),
      totalRepaymentsVolume: round2(totalRepaymentsVolume),
      totalDebts: allDebts.length,
      settledDebtsCount,
      activeDebtsCount,
      pendingDebtsCount,
      disputedCount: disputedCount + disputedPaymentsCount,
      pendingPaymentsCount,
      avgTrustScore,
    };
  }, [allProfiles, allDebts, allPayments]);

  // --- Users list with computed metrics & enhanced trust breakdown ---
  const usersWithMetrics = useMemo(() => {
    return allProfiles.map((profile) => {
      const userDebts = allDebts.filter((d) => d.lender_id === profile.id || d.borrower_id === profile.id);
      const userLentDebts = allDebts.filter((d) => d.lender_id === profile.id && d.status !== 'declined');
      const userBorrowDebts = allDebts.filter((d) => d.borrower_id === profile.id && d.status !== 'declined');
      const userPayments = allPayments.filter((p) => p.paid_by === profile.id);

      let totalLentBalance = 0;
      for (const d of userLentDebts) {
        if (d.status === 'settled') continue;
        const dPayments = allPayments.filter((p) => p.debt_id === d.id);
        totalLentBalance += calculateDebtBalance(d, dPayments).currentBalance;
      }

      let totalOwedBalance = 0;
      for (const d of userBorrowDebts) {
        if (d.status === 'settled') continue;
        const dPayments = allPayments.filter((p) => p.debt_id === d.id);
        totalOwedBalance += calculateDebtBalance(d, dPayments).currentBalance;
      }

      const trust = calculateTrustScore(userDebts, userPayments, profile.id, {
        isIsolated: profile.is_isolated,
        isVerified: profile.is_verified,
      });

      return {
        ...profile,
        debtsCount: userDebts.length,
        totalLentBalance: round2(totalLentBalance),
        totalOwedBalance: round2(totalOwedBalance),
        netBalance: round2(totalLentBalance - totalOwedBalance),
        trustScore: trust.score,
        trustRating: trust.rating,
        trustRatingColor: trust.ratingColor,
        trustBreakdown: trust,
      };
    });
  }, [allProfiles, allDebts, allPayments]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return usersWithMetrics.filter((u) => {
      if (userFilter === 'registered' && u.is_shadow) return false;
      if (userFilter === 'ghost' && !u.is_shadow) return false;
      if (userFilter === 'isolated' && !u.is_isolated) return false;
      if (userFilter === 'active_debts' && u.debtsCount === 0) return false;

      if (!userSearch.trim()) return true;
      const q = userSearch.toLowerCase().trim();
      return (
        (u.full_name && u.full_name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.phone && u.phone.includes(q)) ||
        (u.upi_id && u.upi_id.toLowerCase().includes(q)) ||
        u.id.includes(q)
      );
    });
  }, [usersWithMetrics, userSearch, userFilter]);

  // Filtered live events
  const filteredLiveEvents = useMemo(() => {
    if (liveFilter === 'all') return liveEvents;
    if (liveFilter === 'payments') return liveEvents.filter((e) => e.table === 'payments');
    if (liveFilter === 'debts') return liveEvents.filter((e) => e.table === 'debts');
    if (liveFilter === 'profiles') return liveEvents.filter((e) => e.table === 'profiles');
    if (liveFilter === 'admin') return liveEvents.filter((e) => e.table === 'activity_log');
    return liveEvents;
  }, [liveEvents, liveFilter]);

  // Filtered transactions
  const filteredDebts = useMemo(() => {
    return allDebts.filter((d) => {
      if (txnStatusFilter !== 'all') {
        if (d.status !== txnStatusFilter) return false;
      }

      if (txnMethodFilter !== 'all') {
        const hasPaymentMethod = allPayments.some((p) => {
          if (p.debt_id !== d.id) return false;
          if (txnMethodFilter === 'upi') {
            return isUPIMethod(p.payment_method);
          }
          return (p.payment_method || 'other') === txnMethodFilter;
        });
        if (!hasPaymentMethod) return false;
      }

      if (!txnSearch.trim()) return true;
      const q = txnSearch.toLowerCase().trim();
      const lenderName = d.lender?.full_name?.toLowerCase() || d.lender?.email?.toLowerCase() || '';
      const borrowerName = d.borrower?.full_name?.toLowerCase() || d.borrower?.email?.toLowerCase() || '';
      const notes = d.notes?.toLowerCase() || '';
      const debtId = d.id.toLowerCase();

      const matchesUtr = allPayments.some(
        (p) => p.debt_id === d.id && p.transaction_ref?.toLowerCase().includes(q)
      );

      return (
        lenderName.includes(q) ||
        borrowerName.includes(q) ||
        notes.includes(q) ||
        debtId.includes(q) ||
        matchesUtr
      );
    });
  }, [allDebts, allPayments, txnSearch, txnStatusFilter, txnMethodFilter]);

  // --- Admin Moderation & User Control Actions ---
  const handleToggleIsolation = async (targetUser: Profile, isolate: boolean, reason?: string) => {
    setActionLoading(true);
    setActionFeedback(null);
    try {
      let rpcSuccess = false;
      try {
        const { data, error } = await supabase.rpc('admin_toggle_user_isolation', {
          target_user_id: targetUser.id,
          isolate,
          reason: reason || null,
        });
        if (!error && data?.success) rpcSuccess = true;
      } catch (e) {}

      if (!rpcSuccess) {
        await supabase
          .from('profiles')
          .update({
            is_isolated: isolate,
            isolation_reason: isolate ? (reason || 'Isolated by admin for security review') : null,
          })
          .eq('id', targetUser.id);
      }

      setAllProfiles((prev) =>
        prev.map((p) =>
          p.id === targetUser.id
            ? { ...p, is_isolated: isolate, isolation_reason: isolate ? reason : null }
            : p
        )
      );

      if (selectedUser?.id === targetUser.id) {
        setSelectedUser((prev) =>
          prev ? { ...prev, is_isolated: isolate, isolation_reason: isolate ? reason : null } : null
        );
      }

      addTelemetryEvent({
        table: 'profiles',
        eventType: 'UPDATE',
        title: isolate ? 'User Placed in Quarantine' : 'User Isolation Lifted',
        description: `${targetUser.full_name || targetUser.email} ${isolate ? 'isolated from ledger actions' : 'restored to active standing'}`,
        badgeClass: isolate ? 'bg-red-500/15 text-red-500 border-red-500/20' : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
        icon: isolate ? 'security' : 'lock_open',
        payload: { userId: targetUser.id, isolate, reason },
      });

      // Persist permanently in activity_log
      try {
        await supabase.from('activity_log').insert({
          user_id: currentUserId,
          action: isolate ? 'ADMIN_USER_ISOLATED' : 'ADMIN_USER_UNISOLATED',
          details: {
            target_user_id: targetUser.id,
            target_email: targetUser.email,
            reason: reason || null,
            admin_id: currentUserId,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (_) {}

      setIsolationTarget(null);
      setIsolationReasonInput('');
      setActionFeedback({
        type: 'success',
        text: isolate ? 'Account successfully placed in isolation.' : 'Account isolation lifted.',
      });
    } catch (err: any) {
      setActionFeedback({ type: 'error', text: err.message || 'Action failed' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleVerification = async (targetUser: Profile, verified: boolean) => {
    setActionLoading(true);
    setActionFeedback(null);
    try {
      let rpcSuccess = false;
      try {
        const { data, error } = await supabase.rpc('admin_toggle_user_verification', {
          target_user_id: targetUser.id,
          verified,
        });
        if (!error && data?.success) rpcSuccess = true;
      } catch (e) {}

      if (!rpcSuccess) {
        await supabase
          .from('profiles')
          .update({ is_verified: verified, needs_reverification: false })
          .eq('id', targetUser.id);
      }

      setAllProfiles((prev) =>
        prev.map((p) =>
          p.id === targetUser.id ? { ...p, is_verified: verified, needs_reverification: false } : p
        )
      );

      if (selectedUser?.id === targetUser.id) {
        setSelectedUser((prev) =>
          prev ? { ...prev, is_verified: verified, needs_reverification: false } : null
        );
      }

      addTelemetryEvent({
        table: 'profiles',
        eventType: 'UPDATE',
        title: verified ? 'User Admin-Verified' : 'Verification Cleared',
        description: `Verified standing granted to ${targetUser.full_name || targetUser.email}`,
        badgeClass: verified ? 'bg-blue-500/15 text-blue-500 border-blue-500/20' : 'bg-neutral-500/15 text-neutral-400 border-neutral-500/20',
        icon: 'verified_user',
        payload: { userId: targetUser.id, verified },
      });

      // Persist permanently in activity_log
      try {
        await supabase.from('activity_log').insert({
          user_id: currentUserId,
          action: verified ? 'ADMIN_USER_VERIFIED' : 'ADMIN_USER_UNVERIFIED',
          details: {
            target_user_id: targetUser.id,
            target_email: targetUser.email,
            admin_id: currentUserId,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (_) {}

      setActionFeedback({
        type: 'success',
        text: verified ? 'Account marked as Admin-Verified.' : 'Verification cleared.',
      });
    } catch (err: any) {
      setActionFeedback({ type: 'error', text: err.message || 'Action failed' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleForceReverification = async (targetUser: Profile) => {
    setActionLoading(true);
    setActionFeedback(null);
    try {
      let rpcSuccess = false;
      try {
        const { data, error } = await supabase.rpc('admin_force_reverification', {
          target_user_id: targetUser.id,
        });
        if (!error && data?.success) rpcSuccess = true;
      } catch (e) {}

      if (!rpcSuccess) {
        await supabase
          .from('profiles')
          .update({ needs_reverification: true, is_verified: false })
          .eq('id', targetUser.id);
      }

      setAllProfiles((prev) =>
        prev.map((p) =>
          p.id === targetUser.id ? { ...p, needs_reverification: true, is_verified: false } : p
        )
      );

      if (selectedUser?.id === targetUser.id) {
        setSelectedUser((prev) =>
          prev ? { ...prev, needs_reverification: true, is_verified: false } : null
        );
      }

      addTelemetryEvent({
        table: 'profiles',
        eventType: 'UPDATE',
        title: 'Force Reverification Required',
        description: `Security flagged for ${targetUser.full_name || targetUser.email}`,
        badgeClass: 'bg-amber-500/15 text-amber-500 border-amber-500/20',
        icon: 'contact_page',
        payload: { userId: targetUser.id },
      });

      // Persist permanently in activity_log
      try {
        await supabase.from('activity_log').insert({
          user_id: currentUserId,
          action: 'ADMIN_FORCE_REVERIFICATION',
          details: {
            target_user_id: targetUser.id,
            target_email: targetUser.email,
            admin_id: currentUserId,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (_) {}

      setActionFeedback({ type: 'success', text: 'Account flagged: Reverification will be required.' });
    } catch (err: any) {
      setActionFeedback({ type: 'error', text: err.message || 'Action failed' });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePurgeUser = async (targetUser: Profile, forceCascade = false) => {
    setActionLoading(true);
    try {
      const userDebts = allDebts.filter((d) => d.lender_id === targetUser.id || d.borrower_id === targetUser.id);
      const liveDebts = userDebts.filter((d) => d.status === 'active' || d.status === 'pending');

      if (liveDebts.length > 0 && !forceCascade) {
        throw new Error(
          `Cannot purge account with ${liveDebts.length} active transaction(s). Please resolve or check Force Cascade Purge.`
        );
      }

      let rpcSuccess = false;
      try {
        const { data, error } = await supabase.rpc('admin_delete_user', {
          target_user_id: targetUser.id,
          p_force_cascade: forceCascade,
        });
        if (!error && data?.success) rpcSuccess = true;
      } catch (e) {}

      if (!rpcSuccess) {
        // Fallback: preserve counterparty debts with status='purged' and support notice; delete self-referential debts
        const purgedSystemUserId = '00000000-0000-0000-0000-000000000001';
        try {
          await supabase.from('profiles').upsert({
            id: purgedSystemUserId,
            email: 'purged-account@debtsync.local',
            full_name: 'Purged Account',
            is_purged: true,
            purged_at: new Date().toISOString(),
          });
        } catch (_) {}

        const purgeNotice = `[TRANSACTION PURGED BY ADMIN: Counterparty account (${targetUser.email || targetUser.full_name || targetUser.id}) was purged by an administrator. For inquiries or disputes, contact support@satya-nayak.dev]`;

        for (const d of userDebts) {
          if (d.lender_id === targetUser.id && d.borrower_id === targetUser.id) {
            await supabase.from('payments').delete().eq('debt_id', d.id);
            await supabase.from('debts').delete().eq('id', d.id);
          } else {
            const newNotes = d.notes ? `${purgeNotice}\n\n${d.notes}` : purgeNotice;
            const updatePayload: Record<string, any> = {
              status: 'purged',
              notes: newNotes,
            };
            if (d.lender_id === targetUser.id) updatePayload.lender_id = purgedSystemUserId;
            if (d.borrower_id === targetUser.id) updatePayload.borrower_id = purgedSystemUserId;
            if (d.created_by === targetUser.id) updatePayload.created_by = purgedSystemUserId;

            await supabase.from('debts').update(updatePayload).eq('id', d.id);
          }
        }

        await supabase.from('user_settings').delete().eq('user_id', targetUser.id);
        await supabase.from('contacts').delete().or(`owner_id.eq.${targetUser.id},contact_id.eq.${targetUser.id}`);
        await supabase.from('contact_requests').delete().or(`sender_id.eq.${targetUser.id},receiver_id.eq.${targetUser.id}`);
        const { error: delErr } = await supabase.from('profiles').delete().eq('id', targetUser.id);
        if (delErr) throw delErr;
      }

      // Persist permanent audit record in activity_log
      try {
        await supabase.from('activity_log').insert({
          user_id: currentUserId,
          action: 'ADMIN_USER_PURGED',
          details: {
            target_user_id: targetUser.id,
            target_email: targetUser.email,
            target_phone: targetUser.phone,
            debts_purged_count: userDebts.length,
            active_debts_count: liveDebts.length,
            forced_cascade: forceCascade,
            admin_id: currentUserId,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (_) {}

      setAllProfiles((prev) => prev.filter((p) => p.id !== targetUser.id));
      setSelectedUser(null);
      setPurgeTarget(null);
      setPurgeForceCascade(false);

      addTelemetryEvent({
        table: 'profiles',
        eventType: 'DELETE',
        title: 'User Purged Permanently',
        description: `Account ${targetUser.email} removed by administrator ${forceCascade ? '(Cascade Cleaned)' : ''}`,
        badgeClass: 'bg-red-500/20 text-red-500 border-red-500/30',
        icon: 'delete_forever',
        payload: { userId: targetUser.id, email: targetUser.email, forceCascade },
      });

      await fetchAdminData(true);
    } catch (err: any) {
      alert(`Purge failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const isCurrentUserAdmin = allProfiles.find((p) => p.id === currentUserId)?.is_admin ?? false;

  // Strict Access Guard for Non-Admins
  if (!loading && !isCurrentUserAdmin) {
    const currentEmail = allProfiles.find((p) => p.id === currentUserId)?.email || 'your-email@example.com';
    return (
      <div className="page-enter min-h-[65vh] flex flex-col items-center justify-center text-center p-6 space-y-5 max-w-lg mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center border border-red-500/20 shadow-sm">
          <span className="material-symbols-outlined text-[34px]">lock</span>
        </div>
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-bold text-[var(--on-surface)]">
            Access Restricted
          </h1>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] leading-relaxed">
            The Admin Observatory requires verified Administrator privileges. In accordance with security policy, admin status cannot be self-assigned in-app and must be granted directly via database access.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 font-mono text-xs text-left w-full space-y-2">
          <div className="font-semibold text-[var(--on-surface)] flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">terminal</span>
            <span>Grant via Supabase SQL Editor:</span>
          </div>
          <code className="block p-2.5 rounded-xl bg-[var(--surface-container-high)] text-[var(--primary)] text-[11px] select-all break-all border border-[var(--outline-variant)]/20">
            UPDATE public.profiles SET is_admin = true WHERE email = &apos;{currentEmail}&apos;;
          </code>
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:brightness-110 transition-all shadow-sm"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          <span>Return to Dashboard</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="page-enter space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-[20px]">admin_panel_settings</span>
            </div>
            <h1 className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)]">
              Admin Observatory
            </h1>
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>LIVE SYSTEM</span>
            </div>
          </div>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-1">
            Global monitoring of accounts, live WebSocket telemetry, user moderation, and platform ledgers
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Link
            href="/"
            className="px-3.5 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] font-mono text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Switch back to regular client dashboard view"
          >
            <span className="material-symbols-outlined text-[16px]">person</span>
            <span>Switch to User View</span>
          </Link>

          <button
            type="button"
            onClick={() => fetchAdminData(false)}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] font-mono text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}>
              sync
            </span>
            <span>{loading ? 'Refreshing...' : 'Refresh Records'}</span>
          </button>
        </div>
      </div>

      {/* Admin Tabs */}
      <div className="flex items-center gap-1.5 border-b border-[var(--outline-variant)]/20 pb-2 overflow-x-auto">
        {(
          [
            {
              id: 'overview' as AdminTab,
              label: `Platform Live View (${liveEvents.length})`,
              icon: 'sensors',
              badge: isWebSocketActive ? 'LIVE' : 'CONN',
            },
            {
              id: 'users' as AdminTab,
              label: `Users (${allProfiles.length})`,
              icon: 'manage_accounts',
              badge: metrics.isolatedUsers > 0 ? `${metrics.isolatedUsers} ISOLATED` : undefined,
            },
            {
              id: 'transactions' as AdminTab,
              label: `All Ledgers (${allDebts.length})`,
              icon: 'receipt_long',
              badge: undefined,
            },
            {
              id: 'analytics' as AdminTab,
              label: 'System Analytics',
              icon: 'monitoring',
              badge: undefined,
            },
          ] as Array<{ id: AdminTab; label: string; icon: string; badge?: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleSelectTab(t.id)}
            className={`px-3.5 py-2 rounded-xl font-mono text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-all cursor-pointer ${
              activeTab === t.id
                ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-sm'
                : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">{t.icon}</span>
            <span>{t.label}</span>
            {t.badge && (
              <span
                className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                  activeTab === t.id
                    ? 'bg-white/20 text-white'
                    : t.badge.includes('ISOLATED')
                    ? 'bg-red-500/20 text-red-500'
                    : 'bg-emerald-500/20 text-emerald-500 animate-pulse'
                }`}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* TAB 1: PLATFORM LIVE VIEW & TELEMETRY STREAM */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Top Key Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="p-4 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30">
              <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider block">
                Total Users
              </span>
              <div className="font-heading text-2xl font-bold text-[var(--on-surface)] mt-1">
                {metrics.totalUsers}
              </div>
              <div className="font-mono text-[11px] text-[var(--on-surface-variant)] mt-1 flex items-center gap-2">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">{metrics.registeredUsers} Reg</span>
                <span>•</span>
                <span className="text-amber-600 dark:text-amber-400 font-bold">{metrics.ghostUsers} Ghost</span>
                {metrics.isolatedUsers > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-red-500 font-bold">{metrics.isolatedUsers} Isolated</span>
                  </>
                )}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30">
              <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider block">
                Active Ledgers
              </span>
              <div className="font-heading text-2xl font-bold text-[var(--on-surface)] mt-1">
                {metrics.totalDebts}
              </div>
              <div className="font-mono text-[11px] text-[var(--on-surface-variant)] mt-1 flex items-center gap-2">
                <span className="text-blue-600 dark:text-blue-400 font-bold">{metrics.activeDebtsCount} Open</span>
                <span>•</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">{metrics.settledDebtsCount} Settled</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30">
              <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider block">
                Outstanding Principal
              </span>
              <div className="font-heading text-2xl font-bold text-[var(--primary)] mt-1">
                {formatCurrency(metrics.totalOutstandingVolume, currency)}
              </div>
              <div className="font-mono text-[11px] text-[var(--on-surface-variant)] mt-1">
                Lifetime: {formatCurrency(metrics.totalPrincipalVolume, currency)}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30">
              <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider block">
                Avg Network Score
              </span>
              <div className={`font-heading text-2xl font-bold mt-1 ${
                metrics.avgTrustScore > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--outline)]'
              }`}>
                {metrics.avgTrustScore > 0 ? metrics.avgTrustScore : '-1 (Unrated)'}
              </div>
              <div className="font-mono text-[11px] text-[var(--on-surface-variant)] mt-1">
                {metrics.avgTrustScore > 0 ? 'Multi-Pillar Trust Calibrated' : 'No Settled/Active Records'}
              </div>
            </div>
          </div>

          {/* Real-Time Live Telemetry Stream Console */}
          <div className="space-y-4">
            {/* Controls Bar */}
            <div className="p-4 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/20 font-mono text-xs">
                  <span className={`w-2.5 h-2.5 rounded-full ${isWebSocketActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                  <span className="font-bold text-[var(--on-surface)]">
                    {isWebSocketActive ? 'WebSocket Connected' : 'Connecting WebSocket...'}
                  </span>
                  <span className="text-[10px] text-[var(--outline)]">• {liveEvents.length} events captured</span>
                </div>

                <button
                  type="button"
                  onClick={() => setIsLivePaused(!isLivePaused)}
                  className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
                    isLivePaused
                      ? 'bg-amber-500 text-white'
                      : 'bg-[var(--surface-container-high)] text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {isLivePaused ? 'play_arrow' : 'pause'}
                  </span>
                  <span>{isLivePaused ? 'Resume Stream' : 'Pause Stream'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto">
                {(
                  [
                    { id: 'all', label: 'All Events' },
                    { id: 'payments', label: 'Payments' },
                    { id: 'debts', label: 'Debts' },
                    { id: 'profiles', label: 'Users' },
                    { id: 'admin', label: 'Admin Logs' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setLiveFilter(f.id)}
                    className={`px-3 py-1.5 rounded-lg font-mono text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      liveFilter === f.id
                        ? 'bg-[var(--primary)] text-[var(--on-primary)]'
                        : 'bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setLiveEvents([])}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--outline-variant)]/40 hover:bg-red-500/10 text-red-500 font-mono text-xs font-bold transition-colors cursor-pointer"
                  title="Clear current event buffer"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Stream Logs List */}
            <div className="bg-[var(--surface-container-lowest)] rounded-2xl border border-[var(--outline-variant)]/30 overflow-hidden shadow-sm">
              <div className="p-3 bg-[var(--surface-container)] border-b border-[var(--outline-variant)]/20 font-mono text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-bold text-[var(--on-surface)] uppercase tracking-wider">
                    Live Telemetry Packet Stream
                  </span>
                </div>
                <span className="text-[11px] text-[var(--on-surface-variant)]">Click any entry to inspect payload JSON</span>
              </div>

              <div className="divide-y divide-[var(--outline-variant)]/10 font-mono text-xs max-h-[60vh] overflow-y-auto overscroll-contain">
                {filteredLiveEvents.length === 0 ? (
                  <div className="py-14 text-center text-[var(--on-surface-variant)] space-y-2">
                    <span className="material-symbols-outlined text-[36px] text-[var(--outline)] animate-pulse block">
                      wifi_tethering
                    </span>
                    <p className="font-bold">Awaiting Telemetry Signals</p>
                    <p className="text-[11px] text-[var(--outline)]">
                      Perform a transaction, submit a payment, or alter profile data in another window to see packets live.
                    </p>
                  </div>
                ) : (
                  filteredLiveEvents.map((evt) => (
                    <div
                      key={evt.id}
                      onClick={() => setSelectedTelemetryEvent(evt)}
                      className="p-3.5 flex items-start justify-between gap-4 hover:bg-[var(--surface-container-low)] transition-colors cursor-pointer"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-[var(--surface-container)] flex items-center justify-center shrink-0 mt-0.5">
                          <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">
                            {evt.icon}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-[var(--on-surface)]">
                              {evt.title}
                            </span>
                            <span className={`px-2 py-0.2 rounded text-[9px] font-bold border ${evt.badgeClass}`}>
                              {evt.table.toUpperCase()} • {evt.eventType}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--on-surface-variant)] mt-0.5 truncate">
                            {evt.description}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[11px] text-[var(--outline)] block">
                          {evt.relativeTime}
                        </span>
                        <span className="text-[10px] text-[var(--primary)] hover:underline">
                          Inspect
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: USER CONTROL & MODERATION */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {actionFeedback && (
            <div
              className={`p-3.5 rounded-2xl text-xs font-mono flex items-center justify-between border ${
                actionFeedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-500'
              }`}
            >
              <span>{actionFeedback.text}</span>
              <button
                type="button"
                onClick={() => setActionFeedback(null)}
                className="text-[11px] underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-[var(--on-surface-variant)]">
                search
              </span>
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search by name, email, phone, VPA or ID..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container-lowest)] text-[var(--on-surface)] font-mono text-xs outline-none focus:border-[var(--primary)]"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(
                [
                  { id: 'all', label: 'All Users' },
                  { id: 'registered', label: 'Registered' },
                  { id: 'ghost', label: 'Ghost' },
                  { id: 'isolated', label: 'Quarantined / Isolated' },
                  { id: 'active_debts', label: 'With Debts' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setUserFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg font-mono text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    userFilter === f.id
                      ? 'bg-[var(--primary)] text-[var(--on-primary)]'
                      : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Users Table */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl border border-[var(--outline-variant)]/30 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-[var(--surface-container)] border-b border-[var(--outline-variant)]/20 text-[var(--on-surface-variant)] uppercase">
                  <tr>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Status &amp; Verification</th>
                    <th className="py-3 px-4">Network Score</th>
                    <th className="py-3 px-4">UPI Identifier</th>
                    <th className="py-3 px-4">Lent / Owed</th>
                    <th className="py-3 px-4 text-right">Moderation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--outline-variant)]/10">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[var(--on-surface-variant)]">
                        No users match the search criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => {
                      const detectedVpa = detectUPIApp(u.upi_id);
                      return (
                        <tr key={u.id} className="hover:bg-[var(--surface-container-low)] transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <Avatar src={u.avatar_url} name={u.full_name || u.email} size="sm" />
                              <div className="min-w-0">
                                <span className="font-bold text-[var(--on-surface)] block truncate">
                                  {u.full_name || 'Unnamed User'}
                                </span>
                                <span className="text-[11px] text-[var(--on-surface-variant)] block truncate">
                                  {u.email}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {u.is_isolated ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-500 border border-red-500/30">
                                  ISOLATED
                                </span>
                              ) : u.needs_reverification ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                  REVERIFY
                                </span>
                              ) : u.is_verified ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                                  VERIFIED
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                  ACTIVE
                                </span>
                              )}

                              <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-[var(--surface-container-high)] text-[var(--outline)]">
                                {u.is_shadow ? 'GHOST' : 'REG'}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              {u.trustScore === -1 ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--surface-container-high)] text-[var(--outline)] border border-[var(--outline-variant)]/30">
                                  <span className="material-symbols-outlined text-[12px]">history_toggle_off</span>
                                  <span>-1 (No Score)</span>
                                </span>
                              ) : (
                                <>
                                  <span className="font-bold text-[var(--on-surface)]">{u.trustScore}</span>
                                  <span className={`text-[10px] font-semibold ${u.trustRatingColor}`}>
                                    ({u.trustRating})
                                  </span>
                                  {u.trustBreakdown?.overdueActiveCount > 0 && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-red-500/20 text-red-500" title="Delinquent past due active debts">
                                      {u.trustBreakdown.overdueActiveCount} OVERDUE
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            {u.upi_id ? (
                              <div className="flex items-center gap-1.5">
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${detectedVpa.badgeClass}`}>
                                  {detectedVpa.shortName}
                                </span>
                                <span className="text-[11px] text-[var(--on-surface-variant)] truncate max-w-[120px]">
                                  {u.upi_id}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-[var(--outline)]">No VPA</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-[11px]">
                              <span className="text-emerald-600 dark:text-emerald-400 font-bold block">
                                +{formatCurrency(u.totalLentBalance, currency)}
                              </span>
                              <span className="text-[var(--error)] font-bold block">
                                -{formatCurrency(u.totalOwedBalance, currency)}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedUser(u)}
                                className="px-2.5 py-1 rounded-lg bg-[var(--surface-container-high)] text-[var(--primary)] font-bold hover:bg-[var(--primary)] hover:text-[var(--on-primary)] transition-all cursor-pointer"
                              >
                                Controls
                              </button>
                              {u.is_isolated ? (
                                <button
                                  type="button"
                                  onClick={() => handleToggleIsolation(u, false)}
                                  className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 font-bold hover:bg-emerald-500/20 transition-all cursor-pointer text-[10px]"
                                  title="Lift quarantine"
                                >
                                  Unfreeze
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsolationTarget(u);
                                    setIsolationReasonInput('');
                                  }}
                                  className="px-2 py-1 rounded-lg bg-red-500/10 text-red-500 font-bold hover:bg-red-500/20 transition-all cursor-pointer text-[10px]"
                                  title="Quarantine account"
                                >
                                  Isolate
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: ALL TRANSACTIONS */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          {/* Search & Filters */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-[var(--on-surface-variant)]">
                search
              </span>
              <input
                type="text"
                value={txnSearch}
                onChange={(e) => setTxnSearch(e.target.value)}
                placeholder="Search by counterparty, note, UTR reference, or debt ID..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container-lowest)] text-[var(--on-surface)] font-mono text-xs outline-none focus:border-[var(--primary)]"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto">
              <select
                value={txnStatusFilter}
                onChange={(e: any) => setTxnStatusFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] font-mono text-xs outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="settled">Settled</option>
                <option value="pending">Pending</option>
                <option value="disputed">Disputed</option>
              </select>

              <select
                value={txnMethodFilter}
                onChange={(e) => setTxnMethodFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] font-mono text-xs outline-none"
              >
                <option value="all">All Payment Channels</option>
                <option value="upi">UPI (GPay, PhonePe, Paytm, Slice, Revolut)</option>
                <option value="bank_transfer">Bank Transfer (NEFT/IMPS)</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl border border-[var(--outline-variant)]/30 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-[var(--surface-container)] border-b border-[var(--outline-variant)]/20 text-[var(--on-surface-variant)] uppercase">
                  <tr>
                    <th className="py-3 px-4">Agreement</th>
                    <th className="py-3 px-4">Principal &amp; APR</th>
                    <th className="py-3 px-4">Balance</th>
                    <th className="py-3 px-4">Payment UTR / Ref</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--outline-variant)]/10">
                  {filteredDebts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-[var(--on-surface-variant)]">
                        No transactions found matching filters.
                      </td>
                    </tr>
                  ) : (
                    filteredDebts.map((d) => {
                      const debtPayments = allPayments.filter((p) => p.debt_id === d.id);
                      const calc = calculateDebtBalance(d, debtPayments);
                      const latestPayment = debtPayments[0];
                      const paymentMethodInfo = latestPayment
                        ? formatPaymentMethodDisplay(latestPayment.payment_method, latestPayment.transaction_ref)
                        : null;

                      return (
                        <tr key={d.id} className="hover:bg-[var(--surface-container-low)] transition-colors">
                          <td className="py-3 px-4">
                            <div className="min-w-0">
                              <span className="font-bold text-[var(--on-surface)] block truncate">
                                {d.lender?.full_name || 'Lender'} → {d.borrower?.full_name || 'Borrower'}
                              </span>
                              <span className="text-[10px] text-[var(--outline)] block">
                                ID: {d.id.substring(0, 8)}...
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-bold">
                            <div>
                              <span>{formatCurrency(d.principal, d.currency)}</span>
                              {d.interest_type !== 'none' && (
                                <span className="text-[10px] text-[var(--primary)] block font-normal">
                                  {d.interest_rate}% {d.interest_type}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-bold">
                            <span className={d.status === 'settled' ? 'text-emerald-600' : 'text-[var(--on-surface)]'}>
                              {formatCurrency(calc.currentBalance, d.currency)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {latestPayment?.transaction_ref ? (
                              <div>
                                <span className="font-bold text-[var(--primary)] block truncate max-w-[120px]">
                                  {latestPayment.transaction_ref}
                                </span>
                                <span className="text-[10px] text-[var(--outline)] block">
                                  {paymentMethodInfo?.fullLabel}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-[var(--outline)]">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                d.status === 'settled'
                                  ? 'bg-emerald-500/15 text-emerald-600'
                                  : d.status === 'active'
                                  ? 'bg-blue-500/15 text-blue-600'
                                  : d.status === 'disputed'
                                  ? 'bg-red-500/15 text-red-600'
                                  : 'bg-amber-500/15 text-amber-600'
                              }`}
                            >
                              {d.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[11px] text-[var(--on-surface-variant)]">
                            {new Date(d.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedDebtDetail(d)}
                              className="px-2.5 py-1 rounded-lg bg-[var(--surface-container-high)] text-[var(--primary)] font-bold hover:bg-[var(--primary)] hover:text-[var(--on-primary)] transition-all cursor-pointer"
                            >
                              Audit
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: SYSTEM ANALYTICS */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 space-y-2">
              <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider block">
                Total Debt Principal
              </span>
              <div className="font-heading text-2xl font-bold text-[var(--on-surface)]">
                {formatCurrency(metrics.totalPrincipalVolume, currency)}
              </div>
              <p className="text-[11px] text-[var(--outline)]">Total volume committed across all agreements</p>
            </div>

            <div className="p-5 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 space-y-2">
              <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider block">
                Verified Repayments
              </span>
              <div className="font-heading text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(metrics.totalRepaymentsVolume, currency)}
              </div>
              <p className="text-[11px] text-[var(--outline)]">Direct settlements confirmed on-ledger</p>
            </div>

            <div className="p-5 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 space-y-2">
              <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider block">
                Disputed Cases
              </span>
              <div className="font-heading text-2xl font-bold text-red-500">
                {metrics.disputedCount}
              </div>
              <p className="text-[11px] text-[var(--outline)]">Contested debts or flagged payment receipts</p>
            </div>
          </div>
        </div>
      )}

      {/* USER CONTROL MODAL */}
      {selectedUser && (
        <Modal
          isOpen={Boolean(selectedUser)}
          onClose={() => setSelectedUser(null)}
          title="User Control & Moderation Center"
          subtitle={`Account ID: ${selectedUser.id}`}
          maxWidth="max-w-2xl"
        >
          <div className="space-y-5 font-mono text-xs">
            {/* Header info */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-[var(--surface-container)] rounded-2xl">
              <div className="flex items-center gap-3">
                <Avatar src={selectedUser.avatar_url} name={selectedUser.full_name || selectedUser.email} size="md" />
                <div>
                  <h3 className="font-bold text-base text-[var(--on-surface)]">
                    {selectedUser.full_name || 'Unnamed User'}
                  </h3>
                  <p className="text-xs text-[var(--on-surface-variant)]">{selectedUser.email}</p>
                  {selectedUser.phone && <p className="text-[11px] text-[var(--outline)]">Phone: {selectedUser.phone}</p>}
                </div>
              </div>

              <div className="flex flex-col items-end gap-1">
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${selectedUser.is_isolated ? 'bg-red-500/15 text-red-500 border-red-500/30' : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'}`}>
                  {selectedUser.is_isolated ? 'QUARANTINED / ISOLATED' : 'ACCOUNT ACTIVE'}
                </span>
                {selectedUser.is_shadow && (
                  <span className="text-[10px] text-amber-500 font-bold">Unclaimed Ghost Profile</span>
                )}
              </div>
            </div>

            {selectedUser.is_isolated && selectedUser.isolation_reason && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400">
                <span className="font-bold block">Quarantine Rationale:</span>
                <span>{selectedUser.isolation_reason}</span>
              </div>
            )}

            {/* Moderation Powers Action Bar */}
            <div className="p-4 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 space-y-3">
              <span className="font-bold text-[var(--on-surface)] uppercase tracking-wider block">
                Administrative Powers &amp; Controls
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {selectedUser.is_isolated ? (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleToggleIsolation(selectedUser, false)}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">lock_open</span>
                    <span>Lift Isolation / Unfreeze</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => {
                      setIsolationTarget(selectedUser);
                      setIsolationReasonInput('');
                    }}
                    className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">security</span>
                    <span>Isolate / Quarantine User</span>
                  </button>
                )}

                {selectedUser.is_verified ? (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleToggleVerification(selectedUser, false)}
                    className="px-3.5 py-2 rounded-xl border border-[var(--outline-variant)]/40 hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">remove_moderator</span>
                    <span>Clear Verification</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleToggleVerification(selectedUser, true)}
                    className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">verified</span>
                    <span>Grant Admin Verification</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleForceReverification(selectedUser)}
                  className="px-3.5 py-2 rounded-xl border border-amber-500/40 text-amber-600 hover:bg-amber-500/10 font-bold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">contact_page</span>
                  <span>Require Reverification</span>
                </button>

                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => setPurgeTarget(selectedUser)}
                  className="px-3.5 py-2 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/20 font-bold transition-all cursor-pointer flex items-center gap-1.5 ml-auto"
                >
                  <span className="material-symbols-outlined text-[16px]">delete_forever</span>
                  <span>Purge User</span>
                </button>
              </div>
            </div>

            {/* Network Score & 4 Pillars Breakdown */}
            {/* @ts-ignore */}
            {selectedUser.trustBreakdown && (
              <div className="p-4 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[var(--on-surface)] uppercase tracking-wider block">
                    Network Score Analysis
                  </span>
                  <div className="flex items-center gap-2">
                    {/* @ts-ignore */}
                    <span className={`font-bold text-lg ${selectedUser.trustScore === -1 ? 'text-[var(--outline)]' : 'text-[var(--primary)]'}`}>
                      {/* @ts-ignore */}
                      {selectedUser.trustScore === -1 ? '-1' : selectedUser.trustScore}
                    </span>
                    {/* @ts-ignore */}
                    <span className={`text-xs font-bold ${selectedUser.trustScore === -1 ? 'text-[var(--outline)]' : selectedUser.trustRatingColor}`}>
                      {/* @ts-ignore */}
                      ({selectedUser.trustRating})
                    </span>
                  </div>
                </div>

                {/* @ts-ignore */}
                {selectedUser.trustScore === -1 ? (
                  <div className="p-3 rounded-xl bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/20 text-xs font-mono text-[var(--on-surface-variant)] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-[var(--outline)]">history_toggle_off</span>
                    <span>No transaction history on-ledger yet. Network score is uncalibrated (-1) until first settlement or active debt.</span>
                  </div>
                ) : (
                  /* 4 Pillars Progress Bars */
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-[var(--on-surface-variant)]">Payment Reliability</span>
                        {/* @ts-ignore */}
                        <span className="font-bold">{selectedUser.trustBreakdown.pillars.paymentHistory}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--surface-container-high)] overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          /* @ts-ignore */
                          style={{ width: `${selectedUser.trustBreakdown.pillars.paymentHistory}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-[var(--on-surface-variant)]">Debt Clearance Velocity</span>
                        {/* @ts-ignore */}
                        <span className="font-bold">{selectedUser.trustBreakdown.pillars.debtClearance}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--surface-container-high)] overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          /* @ts-ignore */
                          style={{ width: `${selectedUser.trustBreakdown.pillars.debtClearance}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-[var(--on-surface-variant)]">Network Peer Breadth</span>
                        {/* @ts-ignore */}
                        <span className="font-bold">{selectedUser.trustBreakdown.pillars.networkBreadth}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--surface-container-high)] overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          /* @ts-ignore */
                          style={{ width: `${selectedUser.trustBreakdown.pillars.networkBreadth}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-[var(--on-surface-variant)]">Dispute Cleanliness</span>
                        {/* @ts-ignore */}
                        <span className="font-bold">{selectedUser.trustBreakdown.pillars.disputeCleanliness}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--surface-container-high)] overflow-hidden">
                        <div
                          className="h-full bg-purple-500 rounded-full"
                          /* @ts-ignore */
                          style={{ width: `${selectedUser.trustBreakdown.pillars.disputeCleanliness}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-[var(--outline-variant)]/20 text-right">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="px-4 py-2 rounded-xl bg-[var(--surface-container-high)] text-[var(--on-surface)] font-bold hover:bg-[var(--surface-container-highest)] cursor-pointer"
              >
                Close Center
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ISOLATION CONFIRMATION MODAL */}
      {isolationTarget && (
        <Modal
          isOpen={Boolean(isolationTarget)}
          onClose={() => setIsolationTarget(null)}
          title="Place User Account in Isolation"
          subtitle={`Quarantining: ${isolationTarget.full_name || isolationTarget.email}`}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 font-mono text-xs">
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200">
              <span className="font-bold block mb-1">Impact of Quarantine:</span>
              <ul className="list-disc pl-4 space-y-1 text-[11px]">
                <li>User cannot create new debt agreements</li>
                <li>User cannot submit payment confirmations</li>
                <li>Account flagged with quarantine notice across platform</li>
              </ul>
            </div>

            <div>
              <label className="font-bold text-[var(--on-surface)] block mb-1">
                Reason for Isolation (Audit Log):
              </label>
              <textarea
                value={isolationReasonInput}
                onChange={(e) => setIsolationReasonInput(e.target.value)}
                placeholder="e.g. Unusual dispute velocity, unverified identity, or malicious reports..."
                rows={3}
                className="w-full p-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container-lowest)] text-[var(--on-surface)] outline-none focus:border-red-500 text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsolationTarget(null)}
                className="px-3.5 py-2 rounded-xl bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleToggleIsolation(isolationTarget, true, isolationReasonInput)}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer flex items-center gap-1.5"
              >
                <span>{actionLoading ? 'Quarantining...' : 'Confirm Quarantine'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* PURGE ACCOUNT CONFIRMATION MODAL */}
      {purgeTarget && (() => {
        const targetDebts = allDebts.filter(
          (d) => d.lender_id === purgeTarget.id || d.borrower_id === purgeTarget.id
        );
        const activeDebts = targetDebts.filter((d) => d.status === 'active' || d.status === 'pending');
        const settledDebts = targetDebts.filter((d) => d.status === 'settled');
        const hasLiveDebts = activeDebts.length > 0;

        return (
          <Modal
            isOpen={Boolean(purgeTarget)}
            onClose={() => {
              setPurgeTarget(null);
              setPurgeForceCascade(false);
            }}
            title="Danger: Permanent User Purge"
            subtitle={`Target: ${purgeTarget.email}`}
            maxWidth="max-w-md"
          >
            <div className="space-y-4 font-mono text-xs">
              {hasLiveDebts ? (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-600 dark:text-amber-400 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <span className="material-symbols-outlined text-[20px] text-amber-500">warning</span>
                    <span>Account Has Live Transactions!</span>
                  </div>
                  <p className="text-[11px] text-[var(--on-surface)] leading-relaxed">
                    This account currently has <strong>{activeDebts.length} active/pending transaction(s)</strong> (and {settledDebts.length} settled).
                    When purged with Force Cascade, counterparty ledgers will NOT lose these records: transactions will be safely closed and marked as <strong>(Transaction purged by admin)</strong> with support contact info (<strong>support@satya-nayak.dev</strong>) for any disputes.
                  </p>
                  <label className="flex items-start gap-2 pt-2 border-t border-amber-500/20 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={purgeForceCascade}
                      onChange={(e) => setPurgeForceCascade(e.target.checked)}
                      className="mt-0.5 rounded accent-red-600 cursor-pointer"
                    />
                    <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                      Force cascade: Preserve counterparty audit trail with <em>(Transaction purged by admin)</em> and support contact (support@satya-nayak.dev) before deleting this user profile
                    </span>
                  </label>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500">
                  <span className="font-bold block mb-1">WARNING: IRREVERSIBLE OPERATION</span>
                  <p className="text-[11px]">
                    This will permanently delete this account profile, clear contact connections, and purge associated shadow records.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setPurgeTarget(null);
                    setPurgeForceCascade(false);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={actionLoading || (hasLiveDebts && !purgeForceCascade)}
                  onClick={() => handlePurgeUser(purgeTarget, purgeForceCascade)}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold cursor-pointer transition-opacity"
                >
                  <span>
                    {actionLoading
                      ? 'Purging...'
                      : hasLiveDebts
                      ? 'Force Cascade & Delete'
                      : 'Permanently Delete User'}
                  </span>
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* TELEMETRY PACKET INSPECT MODAL */}
      {selectedTelemetryEvent && (
        <Modal
          isOpen={Boolean(selectedTelemetryEvent)}
          onClose={() => setSelectedTelemetryEvent(null)}
          title="Telemetry Packet Inspection"
          subtitle={`Event ID: ${selectedTelemetryEvent.id}`}
          maxWidth="max-w-xl"
        >
          <div className="space-y-4 font-mono text-xs">
            <div className="p-3 rounded-xl bg-[var(--surface-container)] flex items-center justify-between">
              <div>
                <span className="font-bold text-[var(--on-surface)]">{selectedTelemetryEvent.title}</span>
                <span className="text-[11px] text-[var(--on-surface-variant)] block">{selectedTelemetryEvent.description}</span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${selectedTelemetryEvent.badgeClass}`}>
                {selectedTelemetryEvent.eventType}
              </span>
            </div>

            <div>
              <span className="font-bold text-[var(--on-surface)] block mb-1">Raw Postgres Payload:</span>
              <pre className="p-3 rounded-xl bg-[var(--surface-container-high)] text-[var(--primary)] text-[11px] overflow-x-auto max-h-60 border border-[var(--outline-variant)]/20">
                {JSON.stringify(selectedTelemetryEvent.payload, null, 2)}
              </pre>
            </div>

            <div className="pt-2 text-right">
              <button
                type="button"
                onClick={() => setSelectedTelemetryEvent(null)}
                className="px-4 py-2 rounded-xl bg-[var(--surface-container-high)] text-[var(--on-surface)] font-bold"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Debt Detail Inspect Modal */}
      {selectedDebtDetail && (
        <Modal
          isOpen={Boolean(selectedDebtDetail)}
          onClose={() => setSelectedDebtDetail(null)}
          title="Ledger Agreement Audit"
          subtitle={`Agreement ID: ${selectedDebtDetail.id}`}
          maxWidth="max-w-xl"
        >
          <div className="space-y-4 font-mono text-xs">
            <div className="grid grid-cols-2 gap-3 p-3 bg-[var(--surface-container)] rounded-xl">
              <div>
                <span className="text-[var(--on-surface-variant)] block">Lender:</span>
                <span className="font-bold text-[var(--on-surface)]">
                  {selectedDebtDetail.lender?.full_name || selectedDebtDetail.lender?.email}
                </span>
              </div>
              <div>
                <span className="text-[var(--on-surface-variant)] block">Borrower:</span>
                <span className="font-bold text-[var(--on-surface)]">
                  {selectedDebtDetail.borrower?.full_name || selectedDebtDetail.borrower?.email}
                </span>
              </div>
            </div>

            <div className="p-3 bg-[var(--surface-container)] rounded-xl space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--on-surface-variant)]">Principal:</span>
                <span className="font-bold">{formatCurrency(selectedDebtDetail.principal, selectedDebtDetail.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--on-surface-variant)]">APR &amp; Type:</span>
                <span className="font-bold">{selectedDebtDetail.interest_rate || 0}% ({selectedDebtDetail.interest_type})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--on-surface-variant)]">Status:</span>
                <span className="font-bold capitalize">{selectedDebtDetail.status}</span>
              </div>
            </div>

            <div className="pt-2">
              <span className="font-bold text-[var(--on-surface)] block mb-1.5">Recorded Payments &amp; UTRs</span>
              <div className="max-h-40 overflow-y-auto space-y-1.5">
                {allPayments.filter((p) => p.debt_id === selectedDebtDetail.id).length === 0 ? (
                  <p className="text-[var(--on-surface-variant)] text-[11px]">No repayments recorded yet.</p>
                ) : (
                  allPayments
                    .filter((p) => p.debt_id === selectedDebtDetail.id)
                    .map((p) => {
                      const disp = formatPaymentMethodDisplay(p.payment_method, p.transaction_ref);
                      return (
                        <div key={p.id} className="p-2 rounded-lg bg-[var(--surface-container)] flex items-center justify-between">
                          <div>
                            <span className="font-bold">{formatCurrency(p.amount, p.currency)}</span>
                            <span className="text-[10px] text-[var(--outline)] block">
                              Channel: {disp.fullLabel} {p.transaction_ref && `• Ref/UTR: ${p.transaction_ref}`}
                            </span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.is_verified ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'}`}>
                            {p.is_verified ? 'Verified' : 'Pending'}
                          </span>
                        </div>
                      );
                    })
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--outline-variant)]/20 text-right">
              <button
                type="button"
                onClick={() => setSelectedDebtDetail(null)}
                className="px-4 py-2 rounded-xl bg-[var(--surface-container-high)] text-[var(--on-surface)] font-bold hover:bg-[var(--surface-container-highest)]"
              >
                Close Audit
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
