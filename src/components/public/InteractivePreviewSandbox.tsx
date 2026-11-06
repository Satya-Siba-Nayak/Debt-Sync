'use client';

import React, { useState, useEffect } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/Chip';

export type PreviewTabId =
  | 'dashboard'
  | 'directory'
  | 'detail'
  | 'reminders'
  | 'share'
  | 'split'
  | 'analytics';

interface InteractivePreviewSandboxProps {
  activeTab: PreviewTabId;
  fallbackScreenshotUrl?: string;
}

export function InteractivePreviewSandbox({
  activeTab,
  fallbackScreenshotUrl,
}: InteractivePreviewSandboxProps) {
  const [viewMode, setViewMode] = useState<'interactive' | 'screenshot'>('interactive');
  const [copied, setCopied] = useState(false);

  // --- Dashboard state ---
  const [dashFilter, setDashFilter] = useState<'all' | 'lent' | 'borrowed'>('all');
  const [dashDebts, setDashDebts] = useState([
    {
      id: 'd1',
      title: 'MacBook Pro M3 Share',
      person: 'Rohan Verma',
      personAvatar: 'preset-1',
      type: 'lent',
      principal: 20000,
      balance: 12000,
      apr: 10,
      interestType: '10% Simple APR',
      dueDate: 'Due in 14 days',
      status: 'active' as const,
    },
    {
      id: 'd2',
      title: 'Goa Villa Airbnb Share',
      person: 'Priya Sharma',
      personAvatar: 'preset-7',
      type: 'borrowed',
      principal: 4500,
      balance: 4500,
      apr: 0,
      interestType: '0% Interest',
      dueDate: 'Due in 28 days',
      status: 'active' as const,
    },
  ]);
  const [dashToast, setDashToast] = useState<string | null>(null);

  // --- Directory state ---
  const [directorySearch, setDirectorySearch] = useState('');
  const [directoryFilter, setDirectoryFilter] = useState<'all' | 'active' | 'settled'>('all');
  const [directoryPeople, setDirectoryPeople] = useState([
    {
      id: 'p1',
      name: 'Rohan Verma',
      email: 'rohan.verma@example.com',
      avatar: 'preset-1',
      lent: 12000,
      borrowed: 2000,
      net: 10000,
      trustScore: 812,
      trustRating: 'Exceptional',
      status: 'active' as const,
    },
    {
      id: 'p2',
      name: 'Priya Sharma',
      email: 'priya.sharma@example.com',
      avatar: 'preset-7',
      lent: 0,
      borrowed: 4500,
      net: -4500,
      trustScore: 785,
      trustRating: 'Very Good',
      status: 'active' as const,
    },
    {
      id: 'p3',
      name: 'Karan Mehta',
      email: 'karan.m@example.com',
      avatar: 'preset-13',
      lent: 5000,
      borrowed: 5000,
      net: 0,
      trustScore: 840,
      trustRating: 'Exceptional',
      status: 'settled' as const,
    },
  ]);
  const [directoryToast, setDirectoryToast] = useState<string | null>(null);

  // --- Detail state ---
  const [isReceiptVerified, setIsReceiptVerified] = useState(false);
  const [activeNoteTab, setActiveNoteTab] = useState<'my' | 'counterparty'>('my');
  const [accruedSeconds, setAccruedSeconds] = useState(142.84);

  useEffect(() => {
    if (activeTab !== 'detail') return;
    const interval = setInterval(() => {
      setAccruedSeconds((prev) => +(prev + 0.01).toFixed(2));
    }, 1200);
    return () => clearInterval(interval);
  }, [activeTab]);

  // --- Reminders state ---
  const [reminderType, setReminderType] = useState<'email' | 'push'>('email');
  const [emailQuota, setEmailQuota] = useState(1);
  const [pushQuota, setPushQuota] = useState(2);
  const [reminderDispatched, setReminderDispatched] = useState(false);

  // --- Share state ---
  const [sharePrivacyMode, setSharePrivacyMode] = useState<'public' | 'private'>('public');

  // --- Split state ---
  const [splitTotal, setSplitTotal] = useState(3600);
  const [splitSuccess, setSplitSuccess] = useState(false);

  // --- Analytics state ---
  const [analyticsTimeframe, setAnalyticsTimeframe] = useState<'1M' | '3M' | '6M' | '1Y'>('3M');

  // Reset function
  const resetDemoState = () => {
    setDashDebts([
      {
        id: 'd1',
        title: 'MacBook Pro M3 Share',
        person: 'Rohan Verma',
        personAvatar: 'preset-1',
        type: 'lent',
        principal: 20000,
        balance: 12000,
        apr: 10,
        interestType: '10% Simple APR',
        dueDate: 'Due in 14 days',
        status: 'active' as const,
      },
      {
        id: 'd2',
        title: 'Goa Villa Airbnb Share',
        person: 'Priya Sharma',
        personAvatar: 'preset-7',
        type: 'borrowed',
        principal: 4500,
        balance: 4500,
        apr: 0,
        interestType: '0% Interest',
        dueDate: 'Due in 28 days',
        status: 'active' as const,
      },
    ]);
    setDashToast(null);
    setDirectoryPeople([
      {
        id: 'p1',
        name: 'Rohan Verma',
        email: 'rohan.verma@example.com',
        avatar: 'preset-1',
        lent: 12000,
        borrowed: 2000,
        net: 10000,
        trustScore: 812,
        trustRating: 'Exceptional',
        status: 'active' as const,
      },
      {
        id: 'p2',
        name: 'Priya Sharma',
        email: 'priya.sharma@example.com',
        avatar: 'preset-7',
        lent: 0,
        borrowed: 4500,
        net: -4500,
        trustScore: 785,
        trustRating: 'Very Good',
        status: 'active' as const,
      },
      {
        id: 'p3',
        name: 'Karan Mehta',
        email: 'karan.m@example.com',
        avatar: 'preset-13',
        lent: 5000,
        borrowed: 5000,
        net: 0,
        trustScore: 840,
        trustRating: 'Exceptional',
        status: 'settled' as const,
      },
    ]);
    setDirectoryToast(null);
    setIsReceiptVerified(false);
    setEmailQuota(1);
    setPushQuota(2);
    setReminderDispatched(false);
    setSplitSuccess(false);
  };

  const urlPathMap: Record<PreviewTabId, string> = {
    dashboard: 'debt-sync.satya-nayak.dev/dash',
    directory: 'debt-sync.satya-nayak.dev/directory',
    detail: 'debt-sync.satya-nayak.dev/transactions?id=mbp-m3',
    reminders: 'debt-sync.satya-nayak.dev/reminders/dialog',
    share: 'debt-sync.satya-nayak.dev/share?token=gsh_892b1',
    split: 'debt-sync.satya-nayak.dev/split-bill',
    analytics: 'debt-sync.satya-nayak.dev/analytics',
  };

  const pageTitleMap: Record<PreviewTabId, { title: string; subtitle: string; icon: string }> = {
    dashboard: { title: 'Dashboard', subtitle: 'Overview of your loans, debts & peer balance', icon: 'space_dashboard' },
    directory: { title: 'People Directory', subtitle: 'Manage contacts & reconcile bilateral balances', icon: 'group' },
    detail: { title: 'Agreement Audit Trail', subtitle: 'Mutual terms, receipt timeline & accrual breakdown', icon: 'receipt_long' },
    reminders: { title: 'Payment Reminders', subtitle: 'Quota-controlled courtesy reminders for debtors', icon: 'alarm' },
    share: { title: 'Share Agreement', subtitle: 'Dual cryptographic share links (public vs private)', icon: 'share' },
    split: { title: 'Split Group Bill', subtitle: 'Divide shared expenses across peer ledgers', icon: 'call_split' },
    analytics: { title: 'Cashflow Analytics', subtitle: 'Recovery velocity, projections & settlement times', icon: 'monitoring' },
  };

  const navItems = [
    { id: 'dashboard', label: 'Home', icon: 'space_dashboard' },
    { id: 'directory', label: 'People', icon: 'group' },
    { id: 'detail', label: 'Ledger', icon: 'receipt_long' },
    { id: 'split', label: 'Split', icon: 'call_split' },
    { id: 'reminders', label: 'Alerts', icon: 'alarm' },
    { id: 'share', label: 'Share', icon: 'share' },
    { id: 'analytics', label: 'Insights', icon: 'monitoring' },
  ];

  const currentHeader = pageTitleMap[activeTab];

  return (
    <div className="w-full max-w-4xl mx-auto rounded-2xl overflow-hidden border border-[var(--outline-variant)]/40 bg-[var(--surface-container-lowest)] shadow-2xl transition-all">
      {/* 1. Browser Window Chrome & Titlebar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--outline-variant)]/20 bg-[var(--surface-container)]/90 backdrop-blur-md gap-3 select-none">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block shadow-2xs" />
          <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block shadow-2xs" />
          <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block shadow-2xs" />
        </div>

        {/* Browser URL Bar */}
        <div className="flex-1 max-w-md mx-auto flex items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-[var(--surface)] border border-[var(--outline-variant)]/30 text-[11px] font-mono text-[var(--on-surface-variant)] shadow-2xs truncate">
          <span className="material-symbols-outlined text-[13px] text-emerald-500">lock</span>
          <span className="truncate">{urlPathMap[activeTab]}</span>
        </div>

        {/* Live Sandbox Status & Reset */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Live Interactive Demo</span>
          </div>

          <button
            type="button"
            onClick={resetDemoState}
            title="Reset sandbox demo state"
            className="p-1 rounded-md text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] text-[11px] font-mono transition-colors flex items-center gap-1 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[14px]">restart_alt</span>
            <span className="text-[10px] hidden md:inline">Reset</span>
          </button>

          {fallbackScreenshotUrl && (
            <div className="hidden sm:flex bg-[var(--surface)] p-0.5 rounded-md border border-[var(--outline-variant)]/25 text-[10px] font-mono">
              <button
                type="button"
                onClick={() => setViewMode('interactive')}
                className={`px-2 py-0.5 rounded transition-all font-semibold cursor-pointer ${
                  viewMode === 'interactive'
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-2xs'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                Live
              </button>
              <button
                type="button"
                onClick={() => setViewMode('screenshot')}
                className={`px-2 py-0.5 rounded transition-all font-semibold cursor-pointer ${
                  viewMode === 'screenshot'
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-2xs'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                Shot
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. Window Body */}
      {viewMode === 'screenshot' && fallbackScreenshotUrl ? (
        <div className="p-4 bg-[var(--surface)]">
          <img
            src={fallbackScreenshotUrl}
            alt="Static UI Screenshot"
            className="w-full h-auto rounded-xl object-contain max-h-[540px] mx-auto"
          />
        </div>
      ) : (
        <div className="flex bg-[var(--surface)] min-h-[500px]">
          {/* Mini Left Sidebar (Real App Replica) */}
          <aside className="w-14 sm:w-44 border-r border-[var(--outline-variant)]/25 bg-[var(--surface-container-low)]/80 flex flex-col justify-between p-2.5 sm:p-3 shrink-0">
            <div className="space-y-3">
              {/* Mini Brand Logo */}
              <div className="flex items-center gap-2 px-1">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[var(--primary)] to-teal-400 flex items-center justify-center text-[var(--on-primary)] shadow-xs shrink-0">
                  <span className="material-symbols-outlined text-[15px]">sync_alt</span>
                </div>
                <div className="hidden sm:block">
                  <span className="font-heading font-extrabold text-xs text-[var(--on-surface)] tracking-tight">DebtSync</span>
                  <div className="text-[9px] font-mono text-[var(--on-surface-variant)] leading-none">P2P Ledgers</div>
                </div>
              </div>

              {/* Sidebar Action Button */}
              <div className="pt-1">
                <div className="w-full py-1.5 px-2 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] font-mono text-[11px] font-bold flex items-center justify-center gap-1 shadow-xs cursor-default">
                  <span className="material-symbols-outlined text-[14px]">add_circle</span>
                  <span className="hidden sm:inline">Record Debt</span>
                </div>
              </div>

              {/* Nav Items */}
              <nav className="space-y-0.5 pt-1">
                {navItems.map((item) => {
                  const isActive =
                    item.id === activeTab ||
                    (activeTab === 'detail' && item.id === 'detail') ||
                    (activeTab === 'share' && item.id === 'share') ||
                    (activeTab === 'reminders' && item.id === 'reminders');
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                        isActive
                          ? 'bg-[var(--surface-container-high)] text-[var(--primary)] font-bold shadow-2xs'
                          : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px] shrink-0">{item.icon}</span>
                      <span className="hidden sm:inline truncate">{item.label}</span>
                    </div>
                  );
                })}
              </nav>
            </div>

            {/* User Profile Mini Footer */}
            <div className="pt-2 border-t border-[var(--outline-variant)]/20 flex items-center gap-2 px-1">
              <Avatar name="Satya Nayak" size="xs" />
              <div className="hidden sm:block min-w-0">
                <div className="text-[11px] font-semibold text-[var(--on-surface)] truncate">Satya Nayak</div>
                <div className="text-[9px] font-mono text-[var(--on-surface-variant)] truncate">snayak@dev</div>
              </div>
            </div>
          </aside>

          {/* Main Content Area */}
          <main className="flex-1 p-3 sm:p-5 flex flex-col justify-between overflow-x-hidden">
            <div>
              {/* Mini TopBar Header */}
              <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-[var(--outline-variant)]/20 gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[16px]">{currentHeader.icon}</span>
                  </div>
                  <div>
                    <h2 className="font-heading font-bold text-xs sm:text-sm text-[var(--on-surface)] leading-tight">
                      {currentHeader.title}
                    </h2>
                    <p className="font-mono text-[10px] text-[var(--on-surface-variant)] hidden sm:block">
                      {currentHeader.subtitle}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-7 h-7 rounded-lg bg-[var(--surface-container)] border border-[var(--outline-variant)]/25 flex items-center justify-center text-[var(--on-surface-variant)]">
                    <span className="material-symbols-outlined text-[15px]">notifications</span>
                  </div>
                  <div className="w-7 h-7 rounded-lg bg-[var(--surface-container)] border border-[var(--outline-variant)]/25 flex items-center justify-center text-[var(--on-surface-variant)]">
                    <span className="material-symbols-outlined text-[15px]">dark_mode</span>
                  </div>
                </div>
              </div>

              {/* VIEW 1: DASHBOARD EMULATOR */}
              {activeTab === 'dashboard' && (
                <div className="space-y-4">
                  {/* Real BalanceCards Style Bento */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    {/* Featured Net Position Card */}
                    <div className="sm:col-span-7 rounded-2xl p-4 sm:p-5 border border-[var(--outline-variant)]/30 bg-gradient-to-br from-[var(--surface-container-low)] via-[var(--surface)] to-[var(--surface-container-low)] relative overflow-hidden shadow-xs">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5 text-[var(--on-surface-variant)] font-mono text-[11px] font-semibold uppercase tracking-wider">
                          <span className="material-symbols-outlined text-[15px] text-[var(--primary)]">account_balance</span>
                          <span>Net Portfolio Position</span>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                          Net Creditor
                        </span>
                      </div>

                      <div className="font-heading text-2xl sm:text-3xl font-extrabold text-[var(--primary)] tracking-tight">
                        +₹14,350.00
                      </div>

                      {/* Visual Portfolio Allocation Bar */}
                      <div className="mt-3 space-y-1 text-[10px] font-mono text-[var(--on-surface-variant)]">
                        <div className="flex justify-between">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-[var(--secondary)] inline-block" />
                            <span>Receivable (73%)</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span>Payable (27%)</span>
                            <span className="w-2 h-2 rounded-full bg-[var(--error)] inline-block" />
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-[var(--surface-container-high)] overflow-hidden flex">
                          <div className="h-full bg-[var(--secondary)]" style={{ width: '73%' }} />
                          <div className="h-full bg-[var(--error)]/80" style={{ width: '27%' }} />
                        </div>
                      </div>
                    </div>

                    {/* Secondary Bento Stats */}
                    <div className="sm:col-span-5 grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="p-3 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 flex flex-col justify-between">
                        <span className="text-[10px] text-[var(--on-surface-variant)] uppercase font-semibold">Total Lent</span>
                        <div className="font-bold text-sm text-[var(--secondary)] mt-1">₹22,500</div>
                        <span className="text-[9px] text-[var(--on-surface-variant)]">2 debtors</span>
                      </div>

                      <div className="p-3 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 flex flex-col justify-between">
                        <span className="text-[10px] text-[var(--on-surface-variant)] uppercase font-semibold">Total Borrowed</span>
                        <div className="font-bold text-sm text-[var(--error)] mt-1">₹8,150</div>
                        <span className="text-[9px] text-[var(--on-surface-variant)]">1 creditor</span>
                      </div>

                      <div className="col-span-2 p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-[var(--on-surface-variant)] uppercase font-semibold">Daily Accruing APR</span>
                          <div className="font-bold text-xs text-[var(--primary)] mt-0.5">+₹4.12 / day</div>
                        </div>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                    </div>
                  </div>

                  {/* Filter Tabs & Active Transactions Table */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-heading font-bold text-xs text-[var(--on-surface)]">
                        Active Transactions
                      </h3>
                      <div className="flex bg-[var(--surface-container)] p-0.5 rounded-lg border border-[var(--outline-variant)]/20 text-[10px] font-mono">
                        {(['all', 'lent', 'borrowed'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setDashFilter(t)}
                            className={`px-2 py-0.5 rounded capitalize font-bold transition-all cursor-pointer ${
                              dashFilter === t
                                ? 'bg-[var(--surface)] text-[var(--primary)] shadow-2xs'
                                : 'text-[var(--on-surface-variant)]'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {dashDebts
                        .filter((d) => dashFilter === 'all' || d.type === dashFilter)
                        .map((debt) => (
                          <div
                            key={debt.id}
                            className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 hover:border-[var(--primary)]/30 transition-all shadow-2xs space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Avatar name={debt.person} size="sm" />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-semibold text-xs text-[var(--on-surface)] truncate">{debt.person}</span>
                                    <Chip variant={debt.status} label={debt.status} size="sm" />
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-[var(--primary)]/10 text-[var(--primary)]">
                                      {debt.interestType}
                                    </span>
                                  </div>
                                  <div className="text-[10px] font-mono text-[var(--on-surface-variant)] truncate">
                                    {debt.title} &bull; {debt.dueDate}
                                  </div>
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <div className={`font-bold font-mono text-xs sm:text-sm ${debt.type === 'lent' ? 'text-[var(--secondary)]' : 'text-[var(--error)]'}`}>
                                  {debt.type === 'lent' ? '+' : '-'}₹{debt.balance.toLocaleString()}
                                </div>
                                <span className="text-[9px] font-mono text-[var(--on-surface-variant)]">
                                  Orig: ₹{debt.principal.toLocaleString()}
                                </span>
                              </div>
                            </div>

                            {/* Action Row */}
                            <div className="flex items-center justify-between pt-1 border-t border-[var(--outline-variant)]/15 text-[10px] font-mono">
                              <span className="text-[var(--on-surface-variant)]">
                                Progress: {Math.round(((debt.principal - debt.balance) / debt.principal) * 100)}% repaid
                              </span>

                              {debt.type === 'lent' && debt.balance > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDashDebts((prev) =>
                                      prev.map((item) =>
                                        item.id === debt.id
                                          ? { ...item, balance: Math.max(0, item.balance - 2000) }
                                          : item
                                      )
                                    );
                                    setDashToast('Simulated ₹2,000 repayment recorded! Balance updated.');
                                    setTimeout(() => setDashToast(null), 3500);
                                  }}
                                  className="px-2.5 py-1 rounded-md bg-[var(--primary)] text-[var(--on-primary)] font-bold text-[10px] hover:opacity-90 active:scale-95 transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                                >
                                  <span className="material-symbols-outlined text-[13px]">payments</span>
                                  <span>Simulate ₹2,000 Payment</span>
                                </button>
                              )}
                              {debt.type === 'borrowed' && (
                                <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[12px]">schedule</span>
                                  <span>Repayment Pending</span>
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>

                    {dashToast && (
                      <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-mono flex items-center gap-1.5 animate-fadeIn">
                        <span className="material-symbols-outlined text-[14px]">check_circle</span>
                        <span>{dashToast}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* VIEW 2: PEOPLE DIRECTORY & BILATERAL LEDGERS EMULATOR */}
              {activeTab === 'directory' && (
                <div className="space-y-3 font-mono">
                  {/* Search and Filter Row */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                    <div className="relative flex-1">
                      <span className="material-symbols-outlined absolute left-2.5 top-2 text-[14px] text-[var(--on-surface-variant)]">
                        search
                      </span>
                      <input
                        type="text"
                        placeholder="Search contact or note (e.g. Rohan)..."
                        value={directorySearch}
                        onChange={(e) => setDirectorySearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 text-xs text-[var(--on-surface)] outline-none"
                      />
                    </div>
                    <div className="flex bg-[var(--surface-container)] p-0.5 rounded-lg border border-[var(--outline-variant)]/20 text-[10px]">
                      {(['all', 'active', 'settled'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setDirectoryFilter(f)}
                          className={`px-2 py-0.5 rounded capitalize font-bold transition-all cursor-pointer ${
                            directoryFilter === f
                              ? 'bg-[var(--surface)] text-[var(--primary)] shadow-2xs'
                              : 'text-[var(--on-surface-variant)]'
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Contact Bilateral Ledger Cards */}
                  <div className="space-y-2">
                    {directoryPeople
                      .filter((p) => {
                        if (directoryFilter === 'active' && p.status !== 'active') return false;
                        if (directoryFilter === 'settled' && p.status !== 'settled') return false;
                        if (directorySearch && !p.name.toLowerCase().includes(directorySearch.toLowerCase())) return false;
                        return true;
                      })
                      .map((p) => (
                        <div
                          key={p.id}
                          className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 hover:border-[var(--primary)]/30 transition-all shadow-2xs space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Avatar name={p.name} size="md" />
                              <div className="min-w-0">
                                <div className="font-semibold text-xs text-[var(--on-surface)] flex items-center gap-1.5">
                                  <span className="truncate">{p.name}</span>
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                    Trust: {p.trustScore}
                                  </span>
                                </div>
                                <div className="text-[10px] text-[var(--on-surface-variant)] truncate">{p.email}</div>
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className={`font-bold text-xs sm:text-sm ${p.net > 0 ? 'text-[var(--secondary)]' : p.net < 0 ? 'text-[var(--error)]' : 'text-[var(--on-surface-variant)]'}`}>
                                {p.net > 0 ? `+₹${p.net.toLocaleString()}` : p.net < 0 ? `-₹${Math.abs(p.net).toLocaleString()}` : 'Settled (₹0)'}
                              </div>
                              <span className="text-[9px] text-[var(--on-surface-variant)]">
                                {p.net > 0 ? 'Owed to you' : p.net < 0 ? 'You owe' : 'Balanced'}
                              </span>
                            </div>
                          </div>

                          {/* Bilateral Net Breakdown & 1-Tap Settle */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-[var(--outline-variant)]/15 text-[10px]">
                            <div className="text-[var(--on-surface-variant)]">
                              You lent: <span className="font-bold text-[var(--on-surface)]">₹{p.lent.toLocaleString()}</span> &bull; They lent: <span className="font-bold text-[var(--on-surface)]">₹{p.borrowed.toLocaleString()}</span>
                            </div>

                            {p.net !== 0 ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setDirectoryPeople((prev) =>
                                    prev.map((item) =>
                                      item.id === p.id
                                        ? { ...item, net: 0, status: 'settled', lent: item.borrowed }
                                        : item
                                    )
                                  );
                                  setDirectoryToast(`Bilateral net balance settled with ${p.name}! Balance updated to ₹0.`);
                                  setTimeout(() => setDirectoryToast(null), 3500);
                                }}
                                className="px-2.5 py-1 rounded-md bg-[var(--secondary)] text-[var(--on-secondary)] font-bold text-[10px] hover:opacity-90 active:scale-95 transition-all shadow-2xs flex items-center justify-center gap-1 cursor-pointer self-end sm:self-auto"
                              >
                                <span className="material-symbols-outlined text-[13px]">handshake</span>
                                <span>1-Tap Settle Net Balance</span>
                              </button>
                            ) : (
                              <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                                <span className="material-symbols-outlined text-[13px]">verified</span>
                                <span>Zero Net Balance</span>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>

                  {directoryToast && (
                    <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[10px] flex items-center gap-1.5 animate-fadeIn">
                      <span className="material-symbols-outlined text-[14px]">check_circle</span>
                      <span>{directoryToast}</span>
                    </div>
                  )}
                </div>
              )}

              {/* VIEW 3: DETAIL AUDIT TRAIL & VERIFICATION EMULATOR */}
              {activeTab === 'detail' && (
                <div className="space-y-3 font-mono">
                  {/* Agreement Header */}
                  <div className="p-3 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar name="Rohan Verma" size="md" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-heading font-bold text-xs sm:text-sm text-[var(--on-surface)] truncate">
                            MacBook Pro M3 Share
                          </span>
                          <Chip variant="active" label="Active" size="sm" />
                        </div>
                        <p className="text-[10px] text-[var(--on-surface-variant)] truncate">
                          Lender: Satya Nayak &bull; Borrower: Rohan Verma
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[10px] text-[var(--on-surface-variant)]">Remaining Balance</span>
                      <div className="font-bold text-xs sm:text-sm text-[var(--secondary)]">₹12,000.00</div>
                    </div>
                  </div>

                  {/* Accrued Interest Breakdown with live ticking */}
                  <div className="p-2.5 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-[10px] text-[var(--on-surface-variant)]">Principal</div>
                      <div className="font-bold text-[var(--on-surface)] mt-0.5">₹20,000.00</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[var(--on-surface-variant)]">Terms</div>
                      <div className="font-bold text-[var(--primary)] mt-0.5">10% Simple APR</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[var(--on-surface-variant)]">Live Interest</div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 flex items-center gap-1">
                        <span>+₹{accruedSeconds.toFixed(2)}</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                    </div>
                  </div>

                  {/* Repayment Timeline */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-heading font-bold text-[var(--on-surface)]">
                        Repayments &amp; Verified Receipts
                      </span>
                      <span className="text-[10px] text-[var(--on-surface-variant)]">Click &quot;Verify Receipt&quot; to test</span>
                    </div>

                    <div className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-xs text-[var(--on-surface)]">₹4,000.00 via UPI</div>
                          <div className="text-[10px] text-[var(--on-surface-variant)]">
                            Ref: UPI/9823481239 &bull; Nov 05, 2026
                          </div>
                        </div>

                        {isReceiptVerified ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold border border-emerald-500/30">
                            <span className="material-symbols-outlined text-[13px]">verified</span>
                            <span>Verified by Lender</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setIsReceiptVerified(true)}
                            className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] font-bold text-[10px] hover:opacity-90 active:scale-95 transition-all shadow-xs flex items-center gap-1 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px]">done_all</span>
                            <span>Verify Receipt (1-Tap)</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Two-Sided Notes */}
                    <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/25 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase text-[var(--on-surface-variant)]">
                          Two-Sided Agreement Notes
                        </span>
                        <div className="flex bg-[var(--surface-container)] p-0.5 rounded text-[10px]">
                          <button
                            type="button"
                            onClick={() => setActiveNoteTab('my')}
                            className={`px-2 py-0.5 rounded transition-all font-semibold cursor-pointer ${
                              activeNoteTab === 'my'
                                ? 'bg-[var(--surface)] text-[var(--primary)] shadow-2xs'
                                : 'text-[var(--on-surface-variant)]'
                            }`}
                          >
                            My Note
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveNoteTab('counterparty')}
                            className={`px-2 py-0.5 rounded transition-all font-semibold cursor-pointer ${
                              activeNoteTab === 'counterparty'
                                ? 'bg-[var(--surface)] text-[var(--primary)] shadow-2xs'
                                : 'text-[var(--on-surface-variant)]'
                            }`}
                          >
                            Rohan&apos;s Note
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-[var(--on-surface)] bg-[var(--surface)] p-2 rounded-lg border border-[var(--outline-variant)]/20 italic">
                        {activeNoteTab === 'my'
                          ? '“Approved simple APR at 10% annual. Repayments to be made on 5th of each month.”'
                          : '“Acknowledged. Sent ₹4,000 installment via GPay reference #9823481239.”'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* VIEW 4: REMINDERS & RATE-LIMIT EMULATOR */}
              {activeTab === 'reminders' && (
                <div className="space-y-3 font-mono">
                  {/* Quota Monitors */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                      <div className="flex justify-between text-[10px] text-[var(--on-surface-variant)] uppercase font-semibold">
                        <span>Email Quota</span>
                        <span>{emailQuota}/2 left</span>
                      </div>
                      <div className="w-full bg-[var(--surface-container-high)] h-1.5 rounded-full mt-2 overflow-hidden">
                        <div className="bg-purple-500 h-full rounded-full transition-all" style={{ width: `${(emailQuota / 2) * 100}%` }} />
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                      <div className="flex justify-between text-[10px] text-[var(--on-surface-variant)] uppercase font-semibold">
                        <span>Push Quota</span>
                        <span>{pushQuota}/3 left</span>
                      </div>
                      <div className="w-full bg-[var(--surface-container-high)] h-1.5 rounded-full mt-2 overflow-hidden">
                        <div className="bg-teal-500 h-full rounded-full transition-all" style={{ width: `${(pushQuota / 3) * 100}%` }} />
                      </div>
                    </div>
                  </div>

                  {/* Channel Switcher */}
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setReminderType('email')}
                      className={`flex-1 p-2 rounded-xl border flex items-center justify-center gap-1.5 font-bold transition-all cursor-pointer ${
                        reminderType === 'email'
                          ? 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)] shadow-xs'
                          : 'bg-[var(--surface-container-low)] text-[var(--on-surface)] border-[var(--outline-variant)]/30'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[15px]">mail</span>
                      <span>Email Notice</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReminderType('push')}
                      className={`flex-1 p-2 rounded-xl border flex items-center justify-center gap-1.5 font-bold transition-all cursor-pointer ${
                        reminderType === 'push'
                          ? 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)] shadow-xs'
                          : 'bg-[var(--surface-container-low)] text-[var(--on-surface)] border-[var(--outline-variant)]/30'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[15px]">notifications_active</span>
                      <span>Web Push Alert</span>
                    </button>
                  </div>

                  {/* Polite Message Preview Box */}
                  <div className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 text-xs space-y-1.5">
                    <div className="text-[10px] text-[var(--on-surface-variant)] font-semibold flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px] text-emerald-500">verified</span>
                      <span>Live Preview &bull; Recipient: rohan.verma@example.com</span>
                    </div>
                    <div className="text-[11px] font-bold text-[var(--on-surface)]">
                      Friendly reminder regarding MacBook Pro M3 share (₹12,000 due in 14 days)
                    </div>
                    <p className="text-[10px] text-[var(--on-surface-variant)] leading-relaxed">
                      Hi Rohan, this is an automated courtesy reminder from Satya via DebtSync. An obligation of ₹12,000 is upcoming in 14 days.
                    </p>
                  </div>

                  {/* Dispatch Action */}
                  {reminderDispatched ? (
                    <div className="p-2.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-700 dark:text-purple-300 text-xs font-bold flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">task_alt</span>
                        <span>Reminder queued &amp; dispatched!</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setReminderDispatched(false);
                          setEmailQuota(1);
                        }}
                        className="text-[10px] underline cursor-pointer"
                      >
                        Reset
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEmailQuota((q) => Math.max(0, q - 1));
                        setReminderDispatched(true);
                      }}
                      className="w-full py-2.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-bold text-xs hover:opacity-90 active:scale-98 transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">send</span>
                      <span>Dispatch Polite Reminder (Quota-Safe)</span>
                    </button>
                  )}
                </div>
              )}

              {/* VIEW 5: DUAL SHARE LINKS EMULATOR */}
              {activeTab === 'share' && (
                <div className="space-y-3 font-mono">
                  {/* Mode Toggle */}
                  <div className="flex bg-[var(--surface-container)] p-1 rounded-xl border border-[var(--outline-variant)]/25 text-xs">
                    <button
                      type="button"
                      onClick={() => setSharePrivacyMode('public')}
                      className={`flex-1 py-1.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        sharePrivacyMode === 'public'
                          ? 'bg-[var(--surface)] text-[var(--primary)] shadow-xs'
                          : 'text-[var(--on-surface-variant)]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[15px]">public</span>
                      <span>Public Receipt (No Login)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSharePrivacyMode('private')}
                      className={`flex-1 py-1.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        sharePrivacyMode === 'private'
                          ? 'bg-[var(--surface)] text-[var(--primary)] shadow-xs'
                          : 'text-[var(--on-surface-variant)]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[15px]">lock</span>
                      <span>Private Member Link</span>
                    </button>
                  </div>

                  {/* Privacy Shield Receipt Simulation */}
                  <div className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--on-surface-variant)]">
                        Viewer Privacy Level
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        sharePrivacyMode === 'public'
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      }`}>
                        {sharePrivacyMode === 'public' ? 'Masked & Withheld' : 'Full Member Audit'}
                      </span>
                    </div>

                    <div className="space-y-1.5 bg-[var(--surface)] p-2.5 rounded-lg border border-[var(--outline-variant)]/20 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-[var(--on-surface-variant)]">Agreement:</span>
                        <strong className="text-[var(--on-surface)]">MacBook Pro M3 Share</strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--on-surface-variant)]">Borrower:</span>
                        <span className="font-mono font-bold text-[var(--on-surface)]">
                          {sharePrivacyMode === 'public' ? 'r***a@example.com' : 'rohan.verma@example.com'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--on-surface-variant)]">Balance:</span>
                        <span className="font-bold text-[var(--secondary)]">₹12,000.00</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--on-surface-variant)]">Notes:</span>
                        <span className="italic text-[10px] text-[var(--on-surface-variant)]">
                          {sharePrivacyMode === 'public' ? '[Withheld for privacy]' : 'Approved simple APR at 10%'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Copy Link */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 text-[11px] truncate text-[var(--on-surface-variant)]">
                      {sharePrivacyMode === 'public'
                        ? 'https://debt-sync.satya-nayak.dev/share?token=gsh_pub8923...'
                        : 'https://debt-sync.satya-nayak.dev/accept?token=prv_sec4982...'}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2500);
                      }}
                      className="px-3.5 py-2 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-bold text-xs hover:opacity-90 active:scale-95 transition-all shadow-xs flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        {copied ? 'check' : 'content_copy'}
                      </span>
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* VIEW 6: GROUP BILL SPLIT EMULATOR */}
              {activeTab === 'split' && (
                <div className="space-y-3 font-mono">
                  {/* Bill Header */}
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-600 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[16px]">restaurant</span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-[var(--on-surface)]">Team Dinner &amp; Drinks</div>
                        <div className="text-[10px] text-[var(--on-surface-variant)]">Split across 3 people</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSplitTotal((t) => Math.max(900, t - 300))}
                        className="w-6 h-6 rounded bg-[var(--surface)] border border-[var(--outline-variant)]/30 font-bold text-xs flex items-center justify-center cursor-pointer"
                      >
                        -
                      </button>
                      <span className="font-bold text-xs sm:text-sm text-[var(--on-surface)] px-1">₹{splitTotal.toLocaleString()}</span>
                      <button
                        type="button"
                        onClick={() => setSplitTotal((t) => t + 300)}
                        className="w-6 h-6 rounded bg-[var(--surface)] border border-[var(--outline-variant)]/30 font-bold text-xs flex items-center justify-center cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* 3 Participants */}
                  <div className="space-y-1.5 text-xs">
                    {[
                      { name: 'You (Payer)', share: Math.round(splitTotal / 3), badge: 'Paid full bill' },
                      { name: 'Rohan Verma', share: Math.round(splitTotal / 3), badge: 'Owes you' },
                      { name: 'Priya Sharma', share: Math.round(splitTotal / 3), badge: 'Owes you' },
                    ].map((p, i) => (
                      <div
                        key={i}
                        className="p-2 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/25 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <Avatar name={p.name} size="xs" />
                          <div>
                            <div className="font-semibold text-xs text-[var(--on-surface)]">{p.name}</div>
                            <div className="text-[9px] text-[var(--on-surface-variant)]">{p.badge}</div>
                          </div>
                        </div>
                        <span className="font-bold text-xs text-[var(--primary)]">₹{p.share.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>

                  {splitSuccess ? (
                    <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">check_circle</span>
                        <span>2 bilateral debt agreements created &amp; dispatched!</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setSplitSuccess(false)}
                        className="text-[10px] underline cursor-pointer"
                      >
                        Reset
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSplitSuccess(true)}
                      className="w-full py-2.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-bold text-xs hover:opacity-90 active:scale-98 transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">call_split</span>
                      <span>Generate Split Obligations (₹{Math.round(splitTotal / 3).toLocaleString()} each)</span>
                    </button>
                  )}
                </div>
              )}

              {/* VIEW 7: CASHFLOW ANALYTICS EMULATOR */}
              {activeTab === 'analytics' && (
                <div className="space-y-3 font-mono">
                  {/* Timeframe Bar */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--on-surface)]">Cashflow Performance</span>
                    <div className="flex bg-[var(--surface-container)] p-0.5 rounded-lg border border-[var(--outline-variant)]/25 text-[10px]">
                      {(['1M', '3M', '6M', '1Y'] as const).map((tf) => (
                        <button
                          key={tf}
                          type="button"
                          onClick={() => setAnalyticsTimeframe(tf)}
                          className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer ${
                            analyticsTimeframe === tf
                              ? 'bg-[var(--surface)] text-[var(--primary)] shadow-2xs'
                              : 'text-[var(--on-surface-variant)]'
                          }`}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* KPI Cards */}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                      <span className="text-[10px] text-[var(--on-surface-variant)]">Recovered</span>
                      <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {analyticsTimeframe === '1M' ? '₹8,500' : analyticsTimeframe === '3M' ? '₹24,000' : '₹48,200'}
                      </div>
                      <span className="text-[9px] text-[var(--on-surface-variant)]">74% rate</span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                      <span className="text-[10px] text-[var(--on-surface-variant)]">Outstanding</span>
                      <div className="text-sm font-bold text-[var(--error)] mt-0.5">₹14,350</div>
                      <span className="text-[9px] text-[var(--on-surface-variant)]">2 active</span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                      <span className="text-[10px] text-[var(--on-surface-variant)]">Avg Settle</span>
                      <div className="text-sm font-bold text-[var(--primary)] mt-0.5">14.2 days</div>
                      <span className="text-[9px] text-[var(--on-surface-variant)]">Punctual</span>
                    </div>
                  </div>

                  {/* SVG Bar Chart with Hover Tooltips */}
                  <div className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-[var(--on-surface-variant)]">
                      <span>Monthly Repayment Volumes</span>
                      <span className="text-emerald-500 font-bold">&uarr; +18.4% growth</span>
                    </div>
                    <div className="h-28 flex items-end justify-between gap-2 pt-4 px-2">
                      {[
                        { label: 'May', height: analyticsTimeframe === '1M' ? '30%' : '45%', amount: '₹12k' },
                        { label: 'Jun', height: analyticsTimeframe === '1M' ? '50%' : '65%', amount: '₹18k' },
                        { label: 'Jul', height: analyticsTimeframe === '1M' ? '70%' : '80%', amount: '₹22k' },
                        { label: 'Aug', height: analyticsTimeframe === '1M' ? '40%' : '55%', amount: '₹15k' },
                        { label: 'Sep', height: analyticsTimeframe === '1M' ? '60%' : '75%', amount: '₹20k' },
                        { label: 'Oct', height: analyticsTimeframe === '1M' ? '85%' : '95%', amount: '₹28k' },
                      ].map((bar, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                          <div className="text-[9px] text-[var(--on-surface-variant)] opacity-0 group-hover:opacity-100 transition-opacity">
                            {bar.amount}
                          </div>
                          <div
                            className="w-full bg-[var(--primary)] hover:bg-[var(--secondary)] rounded-t-md transition-all duration-300 shadow-2xs"
                            style={{ height: bar.height }}
                          />
                          <span className="text-[9px] text-[var(--on-surface-variant)]">{bar.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* In-Sandbox Footer */}
            <div className="pt-2.5 mt-3 border-t border-[var(--outline-variant)]/15 flex items-center justify-between text-[10px] font-mono text-[var(--on-surface-variant)] select-none">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                <span>Pixel-Perfect Realtime Sandbox</span>
              </span>
              <span className="hidden sm:inline">Click buttons, toggle filters &amp; test features above!</span>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
