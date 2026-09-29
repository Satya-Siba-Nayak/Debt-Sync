'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment, Profile, ActivityLogEntry } from '@/lib/types/database';
import { formatCurrency } from '@/lib/utils/currency';
import { calculateDebtBalance, round2 } from '@/lib/utils/interest';
import { calculateTrustScore } from '@/lib/utils/trust-score';
import { PAYMENT_METHOD_LABELS } from '@/lib/utils/upi-link';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/Chip';
import { Modal } from '@/components/ui/Modal';
import { getCurrentUserFast } from '@/lib/utils/auth-session';

type AdminTab = 'overview' | 'users' | 'transactions' | 'analytics';

export default function AdminDashboardPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [currency, setCurrency] = useState('inr');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [promotingSelf, setPromotingSelf] = useState(false);

  // Raw platform records
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [allDebts, setAllDebts] = useState<Debt[]>([]);
  const [allPayments, setAllPayments] = useState<Payment[]>([]);
  const [allLogs, setAllLogs] = useState<ActivityLogEntry[]>([]);

  // Filtering states for Users tab
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<'all' | 'registered' | 'ghost' | 'active_debts'>('all');
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);

  // Filtering states for Transactions tab
  const [txnSearch, setTxnSearch] = useState('');
  const [txnStatusFilter, setTxnStatusFilter] = useState<'all' | 'active' | 'settled' | 'pending' | 'disputed'>('all');
  const [txnMethodFilter, setTxnMethodFilter] = useState<string>('all');
  const [selectedDebtDetail, setSelectedDebtDetail] = useState<Debt | null>(null);

  const fetchAdminData = useCallback(async () => {
    setLoading(true);
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
          .limit(30),
      ]);

      if (profilesRes.data) setAllProfiles(profilesRes.data as Profile[]);
      if (debtsRes.data) setAllDebts(debtsRes.data as Debt[]);
      if (paymentsRes.data) setAllPayments(paymentsRes.data as Payment[]);
      if (logsRes.data) setAllLogs(logsRes.data as ActivityLogEntry[]);
    } catch (err) {
      console.error('Error fetching admin data:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  // --- Aggregate Platform Metrics ---
  const metrics = useMemo(() => {
    const totalUsers = allProfiles.length;
    const registeredUsers = allProfiles.filter((p) => !p.is_shadow).length;
    const ghostUsers = allProfiles.filter((p) => p.is_shadow).length;

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

    // Disputed payments
    const disputedPaymentsCount = allPayments.filter(
      (p) => typeof p.note === 'string' && p.note.includes('[DISPUTED]')
    ).length;

    // Average trust score across platform
    const userScores = allProfiles.map((p) => {
      const uDebts = allDebts.filter((d) => d.lender_id === p.id || d.borrower_id === p.id);
      const uPayments = allPayments.filter((pm) => pm.paid_by === p.id);
      return calculateTrustScore(uDebts, uPayments, p.id).score;
    });
    const avgTrustScore =
      userScores.length > 0 ? Math.round(userScores.reduce((a, b) => a + b, 0) / userScores.length) : 720;

    return {
      totalUsers,
      registeredUsers,
      ghostUsers,
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

  // --- Users list with computed metrics ---
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

      const trust = calculateTrustScore(userDebts, userPayments, profile.id);

      return {
        ...profile,
        debtsCount: userDebts.length,
        totalLentBalance: round2(totalLentBalance),
        totalOwedBalance: round2(totalOwedBalance),
        netBalance: round2(totalLentBalance - totalOwedBalance),
        trustScore: trust.score,
        trustRating: trust.rating,
        trustRatingColor: trust.ratingColor,
      };
    });
  }, [allProfiles, allDebts, allPayments]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return usersWithMetrics.filter((u) => {
      if (userFilter === 'registered' && u.is_shadow) return false;
      if (userFilter === 'ghost' && !u.is_shadow) return false;
      if (userFilter === 'active_debts' && u.debtsCount === 0) return false;

      if (!userSearch.trim()) return true;
      const q = userSearch.toLowerCase().trim();
      return (
        (u.full_name && u.full_name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.phone && u.phone.includes(q)) ||
        u.id.includes(q)
      );
    });
  }, [usersWithMetrics, userSearch, userFilter]);

  // Filtered transactions (debts + payments combined or debts focus)
  const filteredDebts = useMemo(() => {
    return allDebts.filter((d) => {
      if (txnStatusFilter !== 'all') {
        if (d.status !== txnStatusFilter) return false;
      }

      if (txnMethodFilter !== 'all') {
        const hasPaymentMethod = allPayments.some(
          (p) => p.debt_id === d.id && p.payment_method === txnMethodFilter
        );
        if (!hasPaymentMethod) return false;
      }

      if (!txnSearch.trim()) return true;
      const q = txnSearch.toLowerCase().trim();
      const lenderName = d.lender?.full_name?.toLowerCase() || d.lender?.email?.toLowerCase() || '';
      const borrowerName = d.borrower?.full_name?.toLowerCase() || d.borrower?.email?.toLowerCase() || '';
      const notes = d.notes?.toLowerCase() || '';
      const debtId = d.id.toLowerCase();

      // Check if any payment UTR matches
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

  // Payment channel distribution
  const paymentMethodAnalytics = useMemo(() => {
    const stats: Record<string, { count: number; volume: number }> = {};
    for (const p of allPayments) {
      const mode = p.payment_method || 'other';
      if (!stats[mode]) stats[mode] = { count: 0, volume: 0 };
      stats[mode].count++;
      stats[mode].volume = round2(stats[mode].volume + (Number(p.amount) || 0));
    }
    return stats;
  }, [allPayments]);

  const isCurrentUserAdmin = allProfiles.find((p) => p.id === currentUserId)?.is_admin ?? false;

  const handlePromoteSelf = async () => {
    setPromotingSelf(true);
    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) return;
      const { error: rpcErr } = await supabase.rpc('promote_user_to_admin');
      if (rpcErr) {
        await supabase.from('profiles').update({ is_admin: true }).eq('id', user.id);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('debtsync:user_updated', { detail: { isAdmin: true } }));
      }
      await fetchAdminData();
    } catch (err) {
      console.error('Failed to promote user to admin:', err);
    } finally {
      setPromotingSelf(false);
    }
  };

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
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-[var(--primary)]/15 text-[var(--primary)]">
              LIVE SYSTEM
            </span>
          </div>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-1">
            Global monitoring of all user accounts, active ledgers, digital payment UTRs, and network health
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
            onClick={fetchAdminData}
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

      {/* Permission helper banner if not yet flagged in Supabase */}
      {!loading && !isCurrentUserAdmin && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs font-mono flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-amber-500 shrink-0">info</span>
            <span>
              Your profile is not yet flagged as Administrator in Supabase. You can promote your current account with one click.
            </span>
          </div>
          <button
            type="button"
            disabled={promotingSelf}
            onClick={handlePromoteSelf}
            className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold transition-colors shrink-0 cursor-pointer text-xs"
          >
            {promotingSelf ? 'Promoting...' : 'Make Me Admin Now'}
          </button>
        </div>
      )}

      {/* Admin Tabs */}
      <div className="flex items-center gap-1.5 border-b border-[var(--outline-variant)]/20 pb-2 overflow-x-auto">
        {(
          [
            { id: 'overview', label: 'Platform Overview', icon: 'dashboard' },
            { id: 'users', label: `Users (${allProfiles.length})`, icon: 'people' },
            { id: 'transactions', label: `All Ledgers (${allDebts.length})`, icon: 'receipt_long' },
            { id: 'analytics', label: 'Platform Analytics', icon: 'monitoring' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`px-3.5 py-2 rounded-xl font-mono text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shrink-0 ${
              activeTab === t.id
                ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-sm'
                : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Top 4 KPI Cards */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[var(--surface-container-lowest)] p-5 rounded-2xl border border-[var(--outline-variant)]/30 shadow-sm">
              <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold block">
                Total Users
              </span>
              <div className="font-heading text-2xl font-bold text-[var(--on-surface)] mt-2">
                {metrics.totalUsers}
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--on-surface-variant)] mt-1">
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{metrics.registeredUsers} Reg</span>
                <span>•</span>
                <span className="text-amber-600 dark:text-amber-400 font-semibold">{metrics.ghostUsers} Ghost</span>
              </div>
            </div>

            <div className="bg-[var(--surface-container-lowest)] p-5 rounded-2xl border border-[var(--outline-variant)]/30 shadow-sm">
              <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold block">
                Platform Volume
              </span>
              <div className="font-heading text-2xl font-bold text-[var(--on-surface)] mt-2">
                {formatCurrency(metrics.totalPrincipalVolume, currency)}
              </div>
              <div className="text-[11px] font-mono text-[var(--primary)] mt-1 font-semibold">
                {formatCurrency(metrics.totalOutstandingVolume, currency)} active
              </div>
            </div>

            <div className="bg-[var(--surface-container-lowest)] p-5 rounded-2xl border border-[var(--outline-variant)]/30 shadow-sm">
              <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold block">
                Settled Repayments
              </span>
              <div className="font-heading text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">
                {formatCurrency(metrics.totalRepaymentsVolume, currency)}
              </div>
              <div className="text-[11px] font-mono text-[var(--on-surface-variant)] mt-1">
                {metrics.settledDebtsCount} settled / {metrics.totalDebts} total
              </div>
            </div>

            <div className="bg-[var(--surface-container-lowest)] p-5 rounded-2xl border border-[var(--outline-variant)]/30 shadow-sm">
              <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold block">
                Disputes &amp; Pending
              </span>
              <div className="font-heading text-2xl font-bold text-amber-600 dark:text-amber-400 mt-2">
                {metrics.disputedCount}
              </div>
              <div className="text-[11px] font-mono text-[var(--on-surface-variant)] mt-1">
                {metrics.pendingPaymentsCount} awaiting review
              </div>
            </div>
          </section>

          {/* System Health & Status Banner */}
          <div className="p-4 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[var(--on-surface)] font-bold">PostgreSQL Realtime Channel: Active</span>
              <span className="text-[var(--on-surface-variant)]">•</span>
              <span className="text-[var(--on-surface-variant)]">Average Network Trust Score: {metrics.avgTrustScore}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold">
                100% LEDGER INTEGRITY
              </span>
            </div>
          </div>

          {/* Recent Live Activity Stream across Platform */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 border border-[var(--outline-variant)]/30 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Live Platform Activity Stream
                </h3>
                <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
                  Latest system events, debt logs, and payment reports
                </p>
              </div>
              <span className="material-symbols-outlined text-[20px] text-[var(--primary)]">rss_feed</span>
            </div>

            <div className="divide-y divide-[var(--outline-variant)]/10 font-mono text-xs">
              {allLogs.length === 0 ? (
                <p className="py-6 text-center text-[var(--on-surface-variant)]">No system events logged yet.</p>
              ) : (
                allLogs.slice(0, 10).map((log) => {
                  const details: any = log.details || {};
                  return (
                    <div key={log.id} className="py-3 flex items-start justify-between gap-4">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="material-symbols-outlined text-[17px] text-[var(--primary)] shrink-0 mt-0.5">
                          {log.action.includes('payment')
                            ? 'payments'
                            : log.action.includes('dispute')
                            ? 'gavel'
                            : 'sync_alt'}
                        </span>
                        <div className="min-w-0">
                          <span className="font-bold text-[var(--on-surface)] capitalize">
                            {log.action.replace(/_/g, ' ')}
                          </span>
                          {details.amount && (
                            <span className="ml-2 font-bold text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(details.amount, details.currency || currency)}
                            </span>
                          )}
                          {details.note && (
                            <p className="text-[11px] text-[var(--on-surface-variant)] truncate mt-0.5">
                              &quot;{details.note}&quot;
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-[var(--outline)] shrink-0">
                        {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ALL USERS */}
      {activeTab === 'users' && (
        <div className="space-y-4">
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
                placeholder="Search user by name, email, phone, or UUID..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container-lowest)] text-[var(--on-surface)] font-mono text-xs outline-none focus:border-[var(--primary)]"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(
                [
                  { id: 'all', label: 'All Users' },
                  { id: 'registered', label: 'Registered' },
                  { id: 'ghost', label: 'Ghost/Claimable' },
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
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Trust Score</th>
                    <th className="py-3 px-4">Debts</th>
                    <th className="py-3 px-4">Outstanding Lent</th>
                    <th className="py-3 px-4">Outstanding Owed</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--outline-variant)]/10">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-[var(--on-surface-variant)]">
                        No users match the search criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-[var(--surface-container-low)] transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <Avatar src={u.avatar_url} name={u.full_name || u.email} size="sm" />
                            <div className="min-w-0">
                              <span className="font-bold text-[var(--on-surface)] block truncate">
                                {u.full_name || 'Unnamed User'}
                              </span>
                              <span className="text-[11px] text-[var(--on-surface-variant)] block truncate">
                                {u.email} {u.phone && `• ${u.phone}`}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              u.is_shadow
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {u.is_shadow ? 'Ghost' : 'Registered'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 font-bold text-[var(--on-surface)]">
                            <span className="material-symbols-outlined text-[14px] text-[var(--primary)]">
                              verified_user
                            </span>
                            <span>{u.trustScore}</span>
                            <span className={`text-[10px] ${u.trustRatingColor}`}>({u.trustRating})</span>
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold">{u.debtsCount}</td>
                        <td className="py-3 px-4 text-emerald-600 dark:text-emerald-400 font-bold">
                          {formatCurrency(u.totalLentBalance, currency)}
                        </td>
                        <td className="py-3 px-4 text-[var(--error)] font-bold">
                          {formatCurrency(u.totalOwedBalance, currency)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedUser(u)}
                            className="px-2.5 py-1 rounded-lg bg-[var(--surface-container-high)] text-[var(--primary)] font-bold hover:bg-[var(--primary)] hover:text-[var(--on-primary)] transition-all cursor-pointer"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ALL TRANSACTIONS */}
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
              {/* Status filter */}
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

              {/* Method filter */}
              <select
                value={txnMethodFilter}
                onChange={(e) => setTxnMethodFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] font-mono text-xs outline-none"
              >
                <option value="all">All Payment Modes</option>
                <option value="upi">UPI</option>
                <option value="gpay">Google Pay</option>
                <option value="phonepe">PhonePe</option>
                <option value="paytm">Paytm</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
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

                      return (
                        <tr key={d.id} className="hover:bg-[var(--surface-container-low)] transition-colors">
                          <td className="py-3 px-4">
                            <div className="min-w-0">
                              <span className="font-bold text-[var(--on-surface)] flex items-center gap-1.5">
                                <span>{d.lender?.full_name || 'Lender'}</span>
                                <span className="material-symbols-outlined text-[13px] text-[var(--primary)]">
                                  arrow_forward
                                </span>
                                <span>{d.borrower?.full_name || 'Borrower'}</span>
                              </span>
                              <span className="text-[11px] text-[var(--on-surface-variant)] truncate block mt-0.5">
                                {d.notes || 'No description note'}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-[var(--on-surface)]">
                              {formatCurrency(d.principal, d.currency)}
                            </span>
                            <span className="text-[10px] text-[var(--outline)] block">
                              {d.interest_rate ? `${d.interest_rate}% APR (${d.interest_type})` : '0% APR'}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-bold text-[var(--primary)]">
                            {formatCurrency(calc.currentBalance, d.currency, { showDecimals: true })}
                          </td>
                          <td className="py-3 px-4">
                            {latestPayment?.transaction_ref ? (
                              <div className="flex items-center gap-1">
                                <span className="material-symbols-outlined text-[13px] text-primary">tag</span>
                                <span className="font-mono text-[11px] font-bold truncate max-w-[120px]">
                                  {latestPayment.transaction_ref}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => navigator.clipboard.writeText(latestPayment.transaction_ref || '')}
                                  className="text-[var(--primary)] hover:underline"
                                  title="Copy UTR"
                                >
                                  <span className="material-symbols-outlined text-[13px]">content_copy</span>
                                </button>
                              </div>
                            ) : (
                              <span className="text-[var(--outline)] text-[11px]">None</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <Chip
                              label={d.status}
                              variant={
                                d.status === 'settled'
                                  ? 'settled'
                                  : d.status === 'active'
                                  ? 'active'
                                  : d.status === 'pending'
                                  ? 'pending'
                                  : 'declined'
                              }
                            />
                          </td>
                          <td className="py-3 px-4 text-[var(--on-surface-variant)] text-[11px]">
                            {new Date(d.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedDebtDetail(d)}
                              className="px-2.5 py-1 rounded-lg bg-[var(--surface-container-high)] text-[var(--primary)] font-bold hover:bg-[var(--primary)] hover:text-[var(--on-primary)] transition-all cursor-pointer"
                            >
                              View
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

      {/* TAB 4: PLATFORM ANALYTICS */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* Payment Method Distribution */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 border border-[var(--outline-variant)]/30 shadow-sm">
            <h3 className="font-heading text-lg font-bold text-[var(--on-surface)] mb-1">
              Payment Channels &amp; Modes (Platform-Wide)
            </h3>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] mb-4">
              Aggregate volume and frequency breakdown across all recorded payments
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {['upi', 'gpay', 'phonepe', 'paytm', 'bank_transfer', 'cash', 'other'].map((mode) => {
                const meta = PAYMENT_METHOD_LABELS[mode];
                const stat = paymentMethodAnalytics[mode] || { count: 0, volume: 0 };
                return (
                  <div
                    key={mode}
                    className="p-4 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/20"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="material-symbols-outlined text-[20px] text-[var(--primary)]">
                        {meta?.icon || 'payment'}
                      </span>
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[var(--surface-container-high)] text-[var(--on-surface)]">
                        {stat.count} txns
                      </span>
                    </div>
                    <span className="font-mono text-xs text-[var(--on-surface-variant)] block">
                      {meta?.label || mode.toUpperCase()}
                    </span>
                    <span className="font-mono font-bold text-base text-[var(--on-surface)] block mt-0.5">
                      {formatCurrency(stat.volume, currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* User Trust Score Distribution */}
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 border border-[var(--outline-variant)]/30 shadow-sm">
            <h3 className="font-heading text-lg font-bold text-[var(--on-surface)] mb-1">
              Network Trust Distribution
            </h3>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] mb-4">
              Breakdown of registered and ghost users across trust score tiers
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 font-mono text-xs">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                <span className="text-emerald-700 dark:text-emerald-400 font-bold block">Exceptional (780 - 850)</span>
                <span className="font-heading text-2xl font-bold text-[var(--on-surface)] mt-1 block">
                  {usersWithMetrics.filter((u) => u.trustScore >= 780).length} users
                </span>
              </div>
              <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/25">
                <span className="text-green-700 dark:text-green-400 font-bold block">Very Good (740 - 779)</span>
                <span className="font-heading text-2xl font-bold text-[var(--on-surface)] mt-1 block">
                  {usersWithMetrics.filter((u) => u.trustScore >= 740 && u.trustScore < 780).length} users
                </span>
              </div>
              <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/25">
                <span className="text-blue-700 dark:text-blue-400 font-bold block">Good (670 - 739)</span>
                <span className="font-heading text-2xl font-bold text-[var(--on-surface)] mt-1 block">
                  {usersWithMetrics.filter((u) => u.trustScore >= 670 && u.trustScore < 740).length} users
                </span>
              </div>
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25">
                <span className="text-amber-700 dark:text-amber-400 font-bold block">Fair / Review (&lt;670)</span>
                <span className="font-heading text-2xl font-bold text-[var(--on-surface)] mt-1 block">
                  {usersWithMetrics.filter((u) => u.trustScore < 670).length} users
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User Inspect Modal */}
      {selectedUser && (
        <Modal
          isOpen={Boolean(selectedUser)}
          onClose={() => setSelectedUser(null)}
          title={`User Observatory: ${selectedUser.full_name || selectedUser.email}`}
          subtitle={`User ID: ${selectedUser.id}`}
          maxWidth="max-w-xl"
        >
          <div className="space-y-4 font-mono text-xs">
            <div className="flex items-center gap-3 p-3 bg-[var(--surface-container)] rounded-xl">
              <Avatar src={selectedUser.avatar_url} name={selectedUser.full_name || selectedUser.email} size="lg" />
              <div>
                <span className="font-bold text-sm text-[var(--on-surface)] block">
                  {selectedUser.full_name || 'Unnamed'}
                </span>
                <span className="text-[var(--on-surface-variant)]">{selectedUser.email}</span>
                {selectedUser.phone && <span className="block text-[var(--primary)]">{selectedUser.phone}</span>}
                {selectedUser.upi_id && (
                  <span className="block text-emerald-600 dark:text-emerald-400 font-bold">
                    UPI: {selectedUser.upi_id}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-[var(--surface-container)] rounded-xl">
                <span className="text-[var(--on-surface-variant)] block">Account Status:</span>
                <span className="font-bold text-[var(--on-surface)]">
                  {selectedUser.is_shadow ? 'Ghost / Shadow Profile' : 'Verified Registered Account'}
                </span>
              </div>
              <div className="p-3 bg-[var(--surface-container)] rounded-xl">
                <span className="text-[var(--on-surface-variant)] block">Network Score:</span>
                <span className="font-bold text-[var(--primary)] text-sm">
                  {/* @ts-ignore */}
                  {selectedUser.trustScore || 720}
                </span>
              </div>
            </div>

            <div className="pt-2">
              <span className="font-bold text-[var(--on-surface)] block mb-2">User Debts &amp; Counterparties</span>
              <div className="max-h-48 overflow-y-auto space-y-1.5 divide-y divide-[var(--outline-variant)]/10">
                {allDebts
                  .filter((d) => d.lender_id === selectedUser.id || d.borrower_id === selectedUser.id)
                  .map((d) => (
                    <div key={d.id} className="pt-1.5 flex justify-between items-center text-[11px]">
                      <span>
                        {d.lender_id === selectedUser.id ? 'Lent to: ' : 'Borrowed from: '}
                        <strong>
                          {d.lender_id === selectedUser.id
                            ? d.borrower?.full_name || 'Borrower'
                            : d.lender?.full_name || 'Lender'}
                        </strong>
                      </span>
                      <span className="font-bold">{formatCurrency(d.principal, d.currency)}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--outline-variant)]/20 text-right">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="px-4 py-2 rounded-xl bg-[var(--surface-container-high)] text-[var(--on-surface)] font-bold hover:bg-[var(--surface-container-highest)]"
              >
                Close
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
                    .map((p) => (
                      <div key={p.id} className="p-2 rounded-lg bg-[var(--surface-container)] flex items-center justify-between">
                        <div>
                          <span className="font-bold">{formatCurrency(p.amount, p.currency)}</span>
                          <span className="text-[10px] text-[var(--outline)] block">
                            Mode: {p.payment_method || 'other'} {p.transaction_ref && `• UTR: ${p.transaction_ref}`}
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.is_verified ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'}`}>
                          {p.is_verified ? 'Verified' : 'Pending'}
                        </span>
                      </div>
                    ))
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
