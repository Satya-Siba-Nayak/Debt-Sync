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

  // --- Real-time Microsecond Interest Ticker (Matches LiveTicker.tsx) ---
  const [tickerMicro, setTickerMicro] = useState(6903);

  useEffect(() => {
    const interval = setInterval(() => {
      setTickerMicro((prev) => (prev >= 9990 ? 1000 : prev + 7));
    }, 180);
    return () => clearInterval(interval);
  }, []);

  // --- Interactive Dashboard State ---
  const [chartMode, setChartMode] = useState<'growth' | 'cashflow'>('growth');
  const [chartDays, setChartDays] = useState<'30D' | '90D' | '1Y'>('30D');
  const [activeLedgersCount, setActiveLedgersCount] = useState(31);
  const [dashToast, setDashToast] = useState<string | null>(null);

  // --- Interactive Directory State ---
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

  // --- Interactive Detail State ---
  const [isReceiptVerified, setIsReceiptVerified] = useState(false);
  const [activeNoteTab, setActiveNoteTab] = useState<'my' | 'counterparty'>('my');

  // --- Interactive Reminders State ---
  const [reminderType, setReminderType] = useState<'email' | 'push'>('email');
  const [emailQuota, setEmailQuota] = useState(1);
  const [pushQuota, setPushQuota] = useState(2);
  const [reminderDispatched, setReminderDispatched] = useState(false);

  // --- Interactive Share State ---
  const [sharePrivacyMode, setSharePrivacyMode] = useState<'public' | 'private'>('public');

  // --- Interactive Split State ---
  const [splitTotal, setSplitTotal] = useState(3600);
  const [splitSuccess, setSplitSuccess] = useState(false);

  // --- Interactive Analytics State ---
  const [analyticsTf, setAnalyticsTf] = useState<'1M' | '3M' | '6M' | '1Y'>('3M');

  // Reset sandbox function
  const resetDemoState = () => {
    setActiveLedgersCount(31);
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

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'space_dashboard' },
    { id: 'directory', label: 'Directory', icon: 'group' },
    { id: 'detail', label: 'Transactions', icon: 'receipt_long' },
    { id: 'analytics', label: 'Analytics', icon: 'monitoring' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <div className="w-full rounded-2xl overflow-hidden border border-[#222e3d] bg-[#0b0f14] shadow-2xl transition-all text-[#e6edf3]">
      {/* 1. Browser Chrome / Window Titlebar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e2634] bg-[#0f141c] gap-3 select-none">
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-3 h-3 rounded-full bg-[#f87171] inline-block shadow-2xs" />
          <span className="w-3 h-3 rounded-full bg-[#fbbf24] inline-block shadow-2xs" />
          <span className="w-3 h-3 rounded-full bg-[#34d399] inline-block shadow-2xs" />
        </div>

        {/* Browser URL Bar */}
        <div className="flex-1 max-w-lg mx-auto flex items-center justify-center gap-2 px-4 py-1 rounded-lg bg-[#141b24] border border-[#222e3d] text-xs font-mono text-[#8a99a8] shadow-2xs truncate">
          <span className="material-symbols-outlined text-[14px] text-[#34d399]">lock</span>
          <span className="truncate">https://debt-sync.satya-nayak.dev/dash</span>
        </div>

        {/* Live Status & Reset */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#07382d] text-[#34d399] border border-[#0d5945]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] animate-pulse" />
            <span>16-Inch Widescreen Live Canvas</span>
          </div>

          <button
            type="button"
            onClick={resetDemoState}
            title="Reset sandbox state"
            className="p-1 rounded-lg text-[#8a99a8] hover:text-white hover:bg-[#1a2330] text-xs font-mono transition-colors flex items-center gap-1 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[15px]">restart_alt</span>
            <span className="text-[11px] hidden md:inline">Reset</span>
          </button>

          {fallbackScreenshotUrl && (
            <div className="hidden sm:flex bg-[#141b24] p-0.5 rounded-lg border border-[#222e3d] text-[10px] font-mono">
              <button
                type="button"
                onClick={() => setViewMode('interactive')}
                className={`px-2.5 py-0.5 rounded-md transition-all font-semibold cursor-pointer ${
                  viewMode === 'interactive'
                    ? 'bg-[#38d9d9] text-[#042124] shadow-2xs font-bold'
                    : 'text-[#8a99a8] hover:text-white'
                }`}
              >
                Live UI
              </button>
              <button
                type="button"
                onClick={() => setViewMode('screenshot')}
                className={`px-2.5 py-0.5 rounded-md transition-all font-semibold cursor-pointer ${
                  viewMode === 'screenshot'
                    ? 'bg-[#38d9d9] text-[#042124] shadow-2xs font-bold'
                    : 'text-[#8a99a8] hover:text-white'
                }`}
              >
                Static Shot
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. Window Body: Exact 16-Inch Laptop App Layout */}
      {viewMode === 'screenshot' && fallbackScreenshotUrl ? (
        <div className="p-4 bg-[#0b0f14]">
          <img
            src={fallbackScreenshotUrl}
            alt="Static UI Screenshot"
            className="w-full h-auto rounded-xl object-contain max-h-[700px] mx-auto shadow-2xl"
          />
        </div>
      ) : (
        <div className="flex bg-[#0b0f14] min-h-[640px] text-[#e6edf3]">
          {/* Authentic Left Sidebar (Exact match to Image 1) */}
          <aside className="w-16 sm:w-56 border-r border-[#1e2634] bg-[#0d1117] flex flex-col justify-between p-3 sm:p-4 shrink-0 select-none">
            <div className="space-y-4">
              {/* Brand Logo Header */}
              <div className="flex items-center gap-3 px-1">
                <div className="w-9 h-9 rounded-xl bg-[#004d4f] border border-[#006e70] flex items-center justify-center text-[#38d9d9] shadow-sm shrink-0">
                  <span className="material-symbols-outlined text-[20px]">sync_alt</span>
                </div>
                <div className="hidden sm:block">
                  <h1 className="font-heading font-extrabold text-base text-white tracking-tight leading-none">
                    DebtSync
                  </h1>
                  <span className="text-[9px] font-mono tracking-widest text-[#6f7f95] uppercase font-bold">
                    Synced Ledgers
                  </span>
                </div>
              </div>

              {/* Action Button: + New Transaction */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setDashToast('Opened Propose Transaction Modal (Simulation)');
                    setTimeout(() => setDashToast(null), 3000);
                  }}
                  className="w-full py-2.5 px-3 rounded-2xl bg-[#38d9d9] text-[#042124] font-heading font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm hover:opacity-95 active:scale-98 transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  <span className="hidden sm:inline">New Transaction</span>
                </button>
              </div>

              {/* Navigation Items */}
              <nav className="space-y-1 pt-1">
                {navItems.map((item) => {
                  const isActive =
                    (activeTab === 'dashboard' && item.id === 'dashboard') ||
                    (activeTab === 'directory' && item.id === 'directory') ||
                    (activeTab === 'detail' && item.id === 'detail') ||
                    (activeTab === 'analytics' && item.id === 'analytics') ||
                    (activeTab === 'split' && item.id === 'dashboard') ||
                    (activeTab === 'reminders' && item.id === 'dashboard') ||
                    (activeTab === 'share' && item.id === 'detail');

                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-mono transition-colors ${
                        isActive
                          ? 'bg-[#132d30] text-[#38d9d9] font-bold border border-[#005a5c]/40 shadow-2xs'
                          : 'text-[#8a99a8] hover:text-white hover:bg-[#141b24]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px] shrink-0">{item.icon}</span>
                      <span className="hidden sm:inline">{item.label}</span>
                    </div>
                  );
                })}
              </nav>
            </div>

            {/* Bottom Sidebar: Theme, Report, Sign Out */}
            <div className="space-y-2.5 pt-3 border-t border-[#1e2634] text-xs font-mono text-[#8a99a8]">
              <div className="hidden sm:flex items-center justify-between px-1">
                <span>Theme</span>
                <div className="flex bg-[#141b24] p-0.5 rounded-lg border border-[#222e3d]">
                  <span className="material-symbols-outlined text-[13px] px-1 text-gray-400">light_mode</span>
                  <span className="material-symbols-outlined text-[13px] px-1 text-[#38d9d9] bg-[#1a2330] rounded">dark_mode</span>
                  <span className="material-symbols-outlined text-[13px] px-1 text-gray-400">laptop</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 px-1 hover:text-white transition-colors cursor-pointer">
                <span className="material-symbols-outlined text-[16px]">warning</span>
                <span className="hidden sm:inline">Report Issue</span>
              </div>

              <div className="flex items-center gap-2.5 px-1 hover:text-white transition-colors cursor-pointer">
                <span className="material-symbols-outlined text-[16px]">logout</span>
                <span className="hidden sm:inline">Sign Out</span>
              </div>
            </div>
          </aside>

          {/* Main Desktop Canvas Area */}
          <main className="flex-1 p-4 sm:p-6 lg:p-7 flex flex-col justify-between overflow-x-hidden space-y-6">
            {/* Top Bar Header (Exact match to Image 1) */}
            <div className="flex items-center justify-between gap-4 pb-2 border-b border-[#1e2634]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#141b24] border border-[#222e3d] flex items-center justify-center text-[#38d9d9] shrink-0 shadow-2xs">
                  <span className="material-symbols-outlined text-[20px]">space_dashboard</span>
                </div>
                <div>
                  <h2 className="font-heading font-extrabold text-lg sm:text-xl text-white tracking-tight leading-tight">
                    Global Dashboard
                  </h2>
                  <p className="font-mono text-xs text-[#8a99a8]">
                    Real-time bilateral portfolio &amp; active obligations
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setDashToast('Opened Split Bill Modal');
                    setTimeout(() => setDashToast(null), 3000);
                  }}
                  className="hidden sm:flex px-3.5 py-1.5 rounded-xl border border-[#253243] bg-[#141b24] text-white font-mono text-xs font-semibold hover:bg-[#1a2330] transition-colors items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px] text-[#38d9d9]">call_split</span>
                  <span>Split Bill</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDashToast('Opened New Entry Modal');
                    setTimeout(() => setDashToast(null), 3000);
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-[#38d9d9] text-[#042124] font-mono text-xs font-bold hover:opacity-95 shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  <span>New Entry</span>
                </button>

                <div className="w-8 h-8 rounded-xl bg-[#141b24] border border-[#222e3d] flex items-center justify-center text-[#8a99a8] relative cursor-pointer">
                  <span className="material-symbols-outlined text-[16px]">notifications</span>
                  <span className="w-2 h-2 rounded-full bg-[#38d9d9] absolute top-1.5 right-1.5" />
                </div>

                <div className="flex items-center gap-2 pl-1.5 py-1 pr-2 rounded-xl bg-[#141b24] border border-[#222e3d] text-xs font-mono text-white cursor-pointer">
                  <Avatar name="Aayush Singh" size="xs" src="https://api.dicebear.com/7.x/bottts/svg?seed=DebtSyncTeal" />
                  <span className="hidden md:inline font-semibold">Aayush Singh</span>
                  <span className="material-symbols-outlined text-[16px] text-[#8a99a8]">expand_more</span>
                </div>
              </div>
            </div>

            {/* TAB CONTENT 1: DASHBOARD (Identical to Image 1) */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                {/* Row 1: The 3 Bento Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  {/* Card 1: NET PORTFOLIO POSITION */}
                  <div className="md:col-span-6 rounded-2xl p-5 bg-[#101720] border border-[#1e2a3a] flex flex-col justify-between shadow-xs">
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[#8a99a8] font-mono text-[11px] uppercase tracking-wider font-semibold">
                          <span className="material-symbols-outlined text-[17px] text-[#38d9d9]">account_balance</span>
                          <span>NET PORTFOLIO POSITION</span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold text-[#34d399] bg-[#063328] border border-[#0d5945]">
                          NET CREDITOR
                        </span>
                      </div>

                      <div className="font-heading text-4xl sm:text-5xl font-extrabold text-[#38d9d9] tracking-tight mt-2.5">
                        +₹508
                      </div>
                    </div>

                    <div className="mt-4 space-y-1.5 font-mono text-[11px] text-[#8a99a8]">
                      <div className="flex justify-between">
                        <span className="flex items-center gap-1.5 text-[#34d399]">
                          <span className="w-2 h-2 rounded-full bg-[#34d399] inline-block" />
                          <span>Receivable (63%)</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-[#f87171]">
                          <span>Payable (37%)</span>
                          <span className="w-2 h-2 rounded-full bg-[#f87171] inline-block" />
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-[#1c2635] overflow-hidden flex">
                        <div className="h-full bg-[#34d399]" style={{ width: '63%' }} />
                        <div className="h-full bg-[#f87171]" style={{ width: '37%' }} />
                      </div>
                    </div>

                    <div className="pt-3 mt-3 border-t border-[#1e2634] flex items-center justify-between text-xs font-mono">
                      <span className="text-[#34d399] font-bold flex items-center gap-1">
                        <span className="material-symbols-outlined text-[15px]">trending_up</span>
                        <span>+₹4 / 30d yield</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveLedgersCount((c) => c + 1);
                          setDashToast('Reconciled 1 additional peer ledger!');
                          setTimeout(() => setDashToast(null), 3000);
                        }}
                        className="text-[#38d9d9] font-bold hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <span>{activeLedgersCount} Active Ledgers</span>
                        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                      </button>
                    </div>
                  </div>

                  {/* Card 2: TOTAL LENT */}
                  <div className="md:col-span-3 rounded-2xl p-5 bg-[#101720] border border-[#1e2a3a] flex flex-col justify-between shadow-xs">
                    <div>
                      <div className="flex items-center justify-between text-[#8a99a8] font-mono text-[11px] uppercase tracking-wider font-semibold">
                        <span>TOTAL LENT</span>
                        <div className="w-7 h-7 rounded-lg bg-[#07382d] text-[#34d399] flex items-center justify-center">
                          <span className="material-symbols-outlined text-[15px]">north_east</span>
                        </div>
                      </div>

                      <div className="font-heading text-3xl font-extrabold text-white mt-1">
                        ₹1,226
                      </div>

                      <div className="px-2 py-0.5 rounded-md bg-[#07382d] text-[#34d399] text-xs font-mono font-bold inline-flex items-center gap-1.5 self-start mt-2 border border-[#0d5945]">
                        <span className="material-symbols-outlined text-[13px]">bar_chart</span>
                        <span>+₹2.69 interest</span>
                      </div>
                    </div>

                    <div className="pt-3 mt-3 border-t border-[#1e2634] flex items-center justify-between text-xs font-mono text-[#8a99a8]">
                      <span>24 active receivables</span>
                      <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                    </div>
                  </div>

                  {/* Card 3: TOTAL OWED */}
                  <div className="md:col-span-3 rounded-2xl p-5 bg-[#101720] border border-[#1e2a3a] flex flex-col justify-between shadow-xs">
                    <div>
                      <div className="flex items-center justify-between text-[#8a99a8] font-mono text-[11px] uppercase tracking-wider font-semibold">
                        <span>TOTAL OWED</span>
                        <div className="w-7 h-7 rounded-lg bg-[#3a1215] text-[#f87171] flex items-center justify-center">
                          <span className="material-symbols-outlined text-[15px]">south_west</span>
                        </div>
                      </div>

                      <div className="font-heading text-3xl font-extrabold text-white mt-1">
                        ₹718
                      </div>

                      <div className="px-2 py-0.5 rounded-md bg-[#3a1215] text-[#f87171] text-xs font-mono font-bold inline-flex items-center gap-1.5 self-start mt-2 border border-[#581c20]">
                        <span className="material-symbols-outlined text-[13px]">show_chart</span>
                        <span>+₹0.94 interest</span>
                      </div>
                    </div>

                    <div className="pt-3 mt-3 border-t border-[#1e2634] flex items-center justify-between text-xs font-mono text-[#8a99a8]">
                      <span>7 active payables</span>
                      <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                    </div>
                  </div>
                </div>

                {/* Row 2: Portfolio Growth & Projection + Interest Engine */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Left Chart Card: Portfolio Growth & Projection (Exact match to Image 1) */}
                  <div className="lg:col-span-8 rounded-2xl p-5 bg-[#101720] border border-[#1e2a3a] flex flex-col justify-between shadow-xs">
                    <div>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-heading font-extrabold text-base text-white">
                              Portfolio Growth &amp; Projection
                            </h3>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#07382d] text-[#34d399] border border-[#0d5945] flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] animate-pulse" />
                              <span>LIVE INTEREST</span>
                            </span>
                          </div>
                          <p className="font-mono text-xs text-[#8a99a8] mt-0.5">
                            Historical balances with continuous compound interest projections
                          </p>
                        </div>

                        {/* Chart Controls */}
                        <div className="flex items-center gap-2 font-mono text-xs">
                          <div className="flex bg-[#141b24] p-0.5 rounded-lg border border-[#222e3d]">
                            <button
                              type="button"
                              onClick={() => setChartMode('growth')}
                              className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                chartMode === 'growth' ? 'bg-[#1c2635] text-white' : 'text-[#8a99a8]'
                              }`}
                            >
                              Growth
                            </button>
                            <button
                              type="button"
                              onClick={() => setChartMode('cashflow')}
                              className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                chartMode === 'cashflow' ? 'bg-[#1c2635] text-white' : 'text-[#8a99a8]'
                              }`}
                            >
                              Cashflow
                            </button>
                          </div>

                          <div className="flex bg-[#141b24] p-0.5 rounded-lg border border-[#222e3d]">
                            {(['30D', '90D', '1Y'] as const).map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setChartDays(d)}
                                className={`px-2 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                  chartDays === d ? 'bg-[#1c2635] text-white' : 'text-[#8a99a8]'
                                }`}
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* SVG Vector Chart (Exact replication of curves and dashed projection) */}
                      <div className="w-full h-56 relative pt-2">
                        <svg className="w-full h-full" viewBox="0 0 600 200" preserveAspectRatio="none">
                          <defs>
                            <linearGradient id="lentGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
                              <stop offset="100%" stopColor="#34d399" stopOpacity="0.0" />
                            </linearGradient>
                            <linearGradient id="owedGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#f87171" stopOpacity="0.25" />
                              <stop offset="100%" stopColor="#f87171" stopOpacity="0.0" />
                            </linearGradient>
                          </defs>

                          {/* Grid Lines */}
                          <line x1="40" y1="20" x2="590" y2="20" stroke="#1c2635" strokeWidth="1" />
                          <line x1="40" y1="55" x2="590" y2="55" stroke="#1c2635" strokeWidth="1" />
                          <line x1="40" y1="90" x2="590" y2="90" stroke="#1c2635" strokeWidth="1" />
                          <line x1="40" y1="125" x2="590" y2="125" stroke="#1c2635" strokeWidth="1" />
                          <line x1="40" y1="160" x2="590" y2="160" stroke="#1c2635" strokeWidth="1" />

                          {/* Y-Axis Labels */}
                          <text x="35" y="24" fill="#6f7f95" fontSize="10" fontFamily="monospace" textAnchor="end">₹1,400</text>
                          <text x="35" y="59" fill="#6f7f95" fontSize="10" fontFamily="monospace" textAnchor="end">₹1,000</text>
                          <text x="35" y="94" fill="#6f7f95" fontSize="10" fontFamily="monospace" textAnchor="end">₹600</text>
                          <text x="35" y="129" fill="#6f7f95" fontSize="10" fontFamily="monospace" textAnchor="end">₹200</text>
                          <text x="35" y="164" fill="#6f7f95" fontSize="10" fontFamily="monospace" textAnchor="end">₹0</text>

                          {/* Owed to You Area Fill */}
                          <path
                            d="M 40 160 L 160 160 Q 200 130 240 115 T 320 65 Q 360 45 400 48 L 400 160 Z"
                            fill="url(#lentGrad)"
                          />
                          {/* Owed to You Solid Curve */}
                          <path
                            d="M 40 160 L 160 160 Q 200 130 240 115 T 320 65 Q 360 45 400 48"
                            fill="none"
                            stroke="#34d399"
                            strokeWidth="2.5"
                          />
                          {/* Owed to You Dashed Future Projection */}
                          <line
                            x1="400"
                            y1="48"
                            x2="590"
                            y2="48"
                            stroke="#34d399"
                            strokeWidth="2.5"
                            strokeDasharray="5,5"
                          />

                          {/* You Owe Solid Curve */}
                          <path
                            d="M 40 160 L 220 160 Q 270 145 310 135 T 400 110"
                            fill="none"
                            stroke="#f87171"
                            strokeWidth="2"
                          />
                          {/* You Owe Dashed Projection */}
                          <line
                            x1="400"
                            y1="110"
                            x2="590"
                            y2="110"
                            stroke="#f87171"
                            strokeWidth="2"
                            strokeDasharray="5,5"
                          />

                          {/* Transition Divider Oct 23 */}
                          <line x1="400" y1="20" x2="400" y2="160" stroke="#253243" strokeWidth="1" strokeDasharray="3,3" />
                        </svg>

                        {/* X-Axis Dates */}
                        <div className="flex justify-between pl-10 pr-2 pt-1 font-mono text-[10px] text-[#6f7f95]">
                          <span>Aug 22</span>
                          <span>Sep 7</span>
                          <span>Sep 22</span>
                          <span>Oct 7</span>
                          <span className="text-[#38d9d9] font-bold">Oct 23</span>
                          <span>Nov 7</span>
                          <span>Nov 22</span>
                        </div>
                      </div>
                    </div>

                    {/* Chart Legend */}
                    <div className="pt-3 mt-2 border-t border-[#1e2634] flex flex-wrap items-center justify-between text-xs font-mono text-[#8a99a8]">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1.5 text-white">
                          <span className="w-2 h-2 rounded-full bg-[#34d399]" />
                          <span>Owed to You</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-white">
                          <span className="w-2 h-2 rounded-full bg-[#f87171]" />
                          <span>You Owe</span>
                        </span>
                      </div>
                      <span className="text-[11px] text-[#6f7f95]">
                        --- Dashed line = Future Compounding Projection
                      </span>
                    </div>
                  </div>

                  {/* Right Card: INTEREST ENGINE (Exact cyan gradient match to Image 1) */}
                  <div
                    className="lg:col-span-4 rounded-2xl p-6 bg-gradient-to-br from-[#0d5c63] via-[#09474c] to-[#042e31] text-white border border-[#15808a]/40 shadow-xl flex flex-col justify-between relative overflow-hidden"
                    style={{
                      backgroundImage: 'radial-gradient(circle at center, rgba(155, 240, 250, 0.08) 1px, transparent 1px)',
                      backgroundSize: '16px 16px',
                    }}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[#90d2da] font-mono text-xs font-bold uppercase tracking-wider">
                          <span className="material-symbols-outlined text-[16px]">timelapse</span>
                          <span>INTEREST ENGINE</span>
                        </div>
                        <span className="bg-[#13717a] text-[#d4fbff] px-2.5 py-0.5 rounded text-[10px] font-mono font-bold border border-[#2297a3]">
                          COMPOUNDING
                        </span>
                      </div>

                      <div className="text-center pt-5 pb-2">
                        <div className="font-mono text-[10px] uppercase tracking-widest text-[#90d2da] font-semibold">
                          TOTAL INTEREST ACCRUED (EARNED)
                        </div>

                        <div className="font-heading font-extrabold tracking-tight mt-2 flex items-baseline justify-center">
                          <span className="text-3xl text-[#90d2da] mr-1">₹</span>
                          <span className="text-6xl text-white">2</span>
                          <span className="text-2xl font-mono text-[#90d2da] ml-0.5">
                            .{tickerMicro}
                          </span>
                        </div>

                        <div className="text-xs font-mono text-[#90d2da] mt-1.5 flex items-center justify-center gap-3">
                          <span>Earned: <strong className="text-white">+₹2.69</strong></span>
                          <span>Incurred: <strong className="text-white">-₹0.94</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="bg-[#032124]/90 rounded-xl p-3 border border-[#0d5c63]/60 flex items-center justify-between text-xs font-mono">
                        <div>
                          <div className="text-[#90d2da] text-[10px] uppercase font-semibold">Accrual Velocity</div>
                          <div className="text-white font-bold mt-0.5">+₹0.14 / day</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[#90d2da] text-[10px] uppercase font-semibold">Monthly Run-rate</div>
                          <div className="text-white font-bold mt-0.5">(+₹4)</div>
                        </div>
                      </div>

                      <div className="text-[10px] font-mono text-[#90d2da] flex items-center justify-center gap-1.5">
                        <span className="material-symbols-outlined text-[14px]">verified</span>
                        <span>Verified against peer agreement terms</span>
                      </div>
                    </div>
                  </div>
                </div>

                {dashToast && (
                  <div className="p-3 rounded-xl bg-[#07382d] border border-[#0d5945] text-[#34d399] font-mono text-xs flex items-center gap-2 animate-fadeIn">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    <span>{dashToast}</span>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT 2: DIRECTORY */}
            {activeTab === 'directory' && (
              <div className="space-y-4 font-mono">
                {/* Search & Filter */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#101720] p-3 rounded-2xl border border-[#1e2a3a]">
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined absolute left-3 top-2.5 text-[16px] text-[#8a99a8]">
                      search
                    </span>
                    <input
                      type="text"
                      placeholder="Search contacts, phone, or two-sided notes..."
                      value={directorySearch}
                      onChange={(e) => setDirectorySearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[#141b24] border border-[#222e3d] text-xs text-white outline-none focus:border-[#38d9d9]"
                    />
                  </div>

                  <div className="flex bg-[#141b24] p-1 rounded-xl border border-[#222e3d] text-xs">
                    {(['all', 'active', 'settled'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setDirectoryFilter(f)}
                        className={`px-3 py-1 rounded-lg capitalize font-bold transition-all cursor-pointer ${
                          directoryFilter === f ? 'bg-[#1c2635] text-[#38d9d9] shadow-xs' : 'text-[#8a99a8]'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Contacts List */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        className="p-4 rounded-2xl bg-[#101720] border border-[#1e2a3a] hover:border-[#38d9d9]/40 transition-all shadow-xs space-y-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar name={p.name} size="md" />
                            <div className="min-w-0">
                              <div className="font-heading font-bold text-sm text-white flex items-center gap-2">
                                <span className="truncate">{p.name}</span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#07382d] text-[#34d399] border border-[#0d5945]">
                                  Trust: {p.trustScore}
                                </span>
                              </div>
                              <div className="text-xs text-[#8a99a8] truncate">{p.email}</div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className={`font-bold text-base ${p.net > 0 ? 'text-[#34d399]' : p.net < 0 ? 'text-[#f87171]' : 'text-[#8a99a8]'}`}>
                              {p.net > 0 ? `+₹${p.net.toLocaleString()}` : p.net < 0 ? `-₹${Math.abs(p.net).toLocaleString()}` : 'Settled (₹0)'}
                            </div>
                            <span className="text-[10px] text-[#8a99a8]">
                              {p.net > 0 ? 'Net Receivable' : p.net < 0 ? 'Net Payable' : 'Zero Balance'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-[#1e2634] text-xs">
                          <div className="text-[#8a99a8]">
                            Lent: <span className="text-white font-bold">₹{p.lent.toLocaleString()}</span> &bull; Borrowed: <span className="text-white font-bold">₹{p.borrowed.toLocaleString()}</span>
                          </div>

                          {p.net !== 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setDirectoryPeople((prev) =>
                                  prev.map((item) =>
                                    item.id === p.id ? { ...item, net: 0, status: 'settled', lent: item.borrowed } : item
                                  )
                                );
                                setDirectoryToast(`1-Tap Settled with ${p.name}! Net balance balanced to ₹0.`);
                                setTimeout(() => setDirectoryToast(null), 3500);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-[#34d399] text-[#042124] font-bold text-xs hover:opacity-90 active:scale-95 transition-all shadow-xs flex items-center gap-1 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[15px]">handshake</span>
                              <span>1-Tap Settle Net</span>
                            </button>
                          ) : (
                            <span className="text-[#34d399] font-bold text-xs flex items-center gap-1">
                              <span className="material-symbols-outlined text-[15px]">verified</span>
                              <span>Settled in Full</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>

                {directoryToast && (
                  <div className="p-3 rounded-xl bg-[#07382d] border border-[#0d5945] text-[#34d399] text-xs flex items-center gap-2 animate-fadeIn">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    <span>{directoryToast}</span>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT 3: DETAIL AUDIT TRAIL */}
            {activeTab === 'detail' && (
              <div className="space-y-4 font-mono">
                <div className="p-5 rounded-2xl bg-[#101720] border border-[#1e2a3a] flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Avatar name="Rohan Verma" size="lg" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-heading font-extrabold text-base text-white">
                          MacBook Pro M3 Share
                        </h3>
                        <Chip variant="active" label="Active" size="sm" />
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#132d30] text-[#38d9d9] border border-[#005a5c]/40">
                          10% Simple APR
                        </span>
                      </div>
                      <p className="text-xs text-[#8a99a8] mt-1">
                        Lender: Satya Nayak &bull; Borrower: Rohan Verma &bull; Due in 14 days
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs text-[#8a99a8]">Remaining Balance</span>
                    <div className="font-heading font-extrabold text-2xl text-[#34d399]">
                      ₹12,000.00
                    </div>
                  </div>
                </div>

                {/* Timeline with Interactive 1-Tap Verification */}
                <div className="p-5 rounded-2xl bg-[#101720] border border-[#1e2a3a] space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-heading font-bold text-white text-sm">Repayment Timeline</span>
                    <span className="text-[#8a99a8]">Click &quot;Verify Receipt&quot; to test mutual consensus</span>
                  </div>

                  <div className="p-4 rounded-xl bg-[#141b24] border border-[#222e3d] flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-sm text-white">₹4,000.00 via UPI Transfer</div>
                      <div className="text-xs text-[#8a99a8] mt-0.5">
                        Ref: UPI/9823481239 &bull; Nov 05, 2026 &bull; GPay
                      </div>
                    </div>

                    {isReceiptVerified ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#07382d] text-[#34d399] font-bold text-xs border border-[#0d5945]">
                        <span className="material-symbols-outlined text-[16px]">verified</span>
                        <span>Verified by Lender</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsReceiptVerified(true)}
                        className="px-4 py-2 rounded-xl bg-[#38d9d9] text-[#042124] font-bold text-xs hover:opacity-90 active:scale-95 transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">done_all</span>
                        <span>Verify Receipt (1-Tap)</span>
                      </button>
                    )}
                  </div>

                  {/* Two-Sided Notes */}
                  <div className="p-4 rounded-xl bg-[#141b24] border border-[#222e3d] space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold uppercase tracking-wider text-[#8a99a8] text-[10px]">
                        Two-Sided Agreement Notes
                      </span>
                      <div className="flex bg-[#1c2635] p-0.5 rounded-lg border border-[#253243]">
                        <button
                          type="button"
                          onClick={() => setActiveNoteTab('my')}
                          className={`px-3 py-1 rounded font-bold cursor-pointer transition-all ${
                            activeNoteTab === 'my' ? 'bg-[#38d9d9] text-[#042124]' : 'text-[#8a99a8]'
                          }`}
                        >
                          My Note
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveNoteTab('counterparty')}
                          className={`px-3 py-1 rounded font-bold cursor-pointer transition-all ${
                            activeNoteTab === 'counterparty' ? 'bg-[#38d9d9] text-[#042124]' : 'text-[#8a99a8]'
                          }`}
                        >
                          Rohan&apos;s Note
                        </button>
                      </div>
                    </div>
                    <p className="p-3 rounded-lg bg-[#0d1117] border border-[#1e2634] text-white italic">
                      {activeNoteTab === 'my'
                        ? '“Approved simple APR at 10% annual. Repayments to be made on 5th of each month.”'
                        : '“Acknowledged. Sent ₹4,000 installment via GPay reference #9823481239.”'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT 4: REMINDERS */}
            {activeTab === 'reminders' && (
              <div className="space-y-4 font-mono max-w-2xl mx-auto">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-2xl bg-[#101720] border border-[#1e2a3a]">
                    <div className="flex justify-between text-[#8a99a8] text-[10px] uppercase font-bold">
                      <span>Weekly Email Quota</span>
                      <span>{emailQuota}/2 left</span>
                    </div>
                    <div className="w-full bg-[#1c2635] h-2 rounded-full mt-2 overflow-hidden">
                      <div className="bg-purple-500 h-full rounded-full transition-all" style={{ width: `${(emailQuota / 2) * 100}%` }} />
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl bg-[#101720] border border-[#1e2a3a]">
                    <div className="flex justify-between text-[#8a99a8] text-[10px] uppercase font-bold">
                      <span>Weekly Push Quota</span>
                      <span>{pushQuota}/3 left</span>
                    </div>
                    <div className="w-full bg-[#1c2635] h-2 rounded-full mt-2 overflow-hidden">
                      <div className="bg-teal-500 h-full rounded-full transition-all" style={{ width: `${(pushQuota / 3) * 100}%` }} />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setReminderType('email')}
                    className={`flex-1 p-3 rounded-2xl border flex items-center justify-center gap-2 font-bold cursor-pointer transition-all ${
                      reminderType === 'email' ? 'bg-[#38d9d9] text-[#042124] border-[#38d9d9]' : 'bg-[#101720] text-white border-[#1e2a3a]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">mail</span>
                    <span>Email Courtesy Reminder</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setReminderType('push')}
                    className={`flex-1 p-3 rounded-2xl border flex items-center justify-center gap-2 font-bold cursor-pointer transition-all ${
                      reminderType === 'push' ? 'bg-[#38d9d9] text-[#042124] border-[#38d9d9]' : 'bg-[#101720] text-white border-[#1e2a3a]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">notifications_active</span>
                    <span>Web Push Alert</span>
                  </button>
                </div>

                <div className="p-4 rounded-2xl bg-[#101720] border border-[#1e2a3a] space-y-2 text-xs">
                  <div className="text-[10px] text-[#8a99a8] font-bold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px] text-[#34d399]">verified</span>
                    <span>Preview &bull; To: rohan.verma@example.com</span>
                  </div>
                  <div className="font-bold text-white text-sm">
                    Friendly reminder regarding MacBook Pro M3 share (₹12,000 due in 14 days)
                  </div>
                  <p className="text-[#8a99a8] leading-relaxed">
                    Hi Rohan, this is an automated courtesy reminder from Satya via DebtSync. An obligation of ₹12,000 is upcoming in 14 days.
                  </p>
                </div>

                {reminderDispatched ? (
                  <div className="p-3 rounded-2xl bg-[#07382d] border border-[#0d5945] text-[#34d399] font-bold text-xs flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">task_alt</span>
                      <span>Reminder successfully queued &amp; dispatched!</span>
                    </span>
                    <button type="button" onClick={() => { setReminderDispatched(false); setEmailQuota(1); }} className="underline cursor-pointer">
                      Reset
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setEmailQuota((q) => Math.max(0, q - 1)); setReminderDispatched(true); }}
                    className="w-full py-3 rounded-2xl bg-[#38d9d9] text-[#042124] font-bold text-xs hover:opacity-90 active:scale-98 transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">send</span>
                    <span>Dispatch Courtesy Reminder (Quota-Protected)</span>
                  </button>
                )}
              </div>
            )}

            {/* TAB CONTENT 5: SHARE */}
            {activeTab === 'share' && (
              <div className="space-y-4 font-mono max-w-2xl mx-auto">
                <div className="flex bg-[#101720] p-1.5 rounded-2xl border border-[#1e2a3a] text-xs">
                  <button
                    type="button"
                    onClick={() => setSharePrivacyMode('public')}
                    className={`flex-1 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      sharePrivacyMode === 'public' ? 'bg-[#38d9d9] text-[#042124] shadow-xs' : 'text-[#8a99a8]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">public</span>
                    <span>Public Receipt (Masked Privacy)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSharePrivacyMode('private')}
                    className={`flex-1 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      sharePrivacyMode === 'private' ? 'bg-[#38d9d9] text-[#042124] shadow-xs' : 'text-[#8a99a8]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">lock</span>
                    <span>Private Cryptographic Link</span>
                  </button>
                </div>

                <div className="p-5 rounded-2xl bg-[#101720] border border-[#1e2a3a] space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#8a99a8]">
                      Viewer Privacy Mode
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      sharePrivacyMode === 'public' ? 'bg-[#3a1215] text-[#f87171] border border-[#581c20]' : 'bg-[#07382d] text-[#34d399] border border-[#0d5945]'
                    }`}>
                      {sharePrivacyMode === 'public' ? 'Emails Masked & Notes Withheld' : 'Authenticated Mutual Access'}
                    </span>
                  </div>

                  <div className="space-y-2 bg-[#0d1117] p-3 rounded-xl border border-[#1e2634]">
                    <div className="flex justify-between">
                      <span className="text-[#8a99a8]">Agreement:</span>
                      <strong className="text-white">MacBook Pro M3 Share</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a99a8]">Borrower Email:</span>
                      <span className="font-mono font-bold text-white">
                        {sharePrivacyMode === 'public' ? 'r***a@example.com' : 'rohan.verma@example.com'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a99a8]">Remaining Balance:</span>
                      <span className="font-bold text-[#34d399]">₹12,000.00</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a99a8]">Agreement Notes:</span>
                      <span className="italic text-[#8a99a8]">
                        {sharePrivacyMode === 'public' ? '[Withheld on Public Link]' : 'Approved simple APR at 10%'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1 px-4 py-2.5 rounded-2xl bg-[#101720] border border-[#1e2a3a] text-xs font-mono truncate text-[#8a99a8]">
                    {sharePrivacyMode === 'public'
                      ? 'https://debt-sync.satya-nayak.dev/share?token=gsh_pub8923...'
                      : 'https://debt-sync.satya-nayak.dev/accept?token=prv_sec4982...'}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }}
                    className="px-4 py-2.5 rounded-2xl bg-[#38d9d9] text-[#042124] font-bold text-xs hover:opacity-90 active:scale-95 transition-all shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <span className="material-symbols-outlined text-[16px]">{copied ? 'check' : 'content_copy'}</span>
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB CONTENT 6: SPLIT BILL */}
            {activeTab === 'split' && (
              <div className="space-y-4 font-mono max-w-2xl mx-auto">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-[#101720] border border-[#1e2a3a]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[20px]">restaurant</span>
                    </div>
                    <div>
                      <h4 className="font-heading font-bold text-sm text-white">Team Dinner &amp; Drinks</h4>
                      <p className="text-xs text-[#8a99a8]">3 Participants &bull; Split Equally</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSplitTotal((t) => Math.max(900, t - 300))}
                      className="w-8 h-8 rounded-lg bg-[#141b24] border border-[#222e3d] font-bold text-sm text-white hover:bg-[#1c2635] flex items-center justify-center cursor-pointer"
                    >
                      -
                    </button>
                    <span className="font-heading font-extrabold text-lg text-white px-2">₹{splitTotal.toLocaleString()}</span>
                    <button
                      type="button"
                      onClick={() => setSplitTotal((t) => t + 300)}
                      className="w-8 h-8 rounded-lg bg-[#141b24] border border-[#222e3d] font-bold text-sm text-white hover:bg-[#1c2635] flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {[
                    { name: 'You (Payer)', share: Math.round(splitTotal / 3), badge: 'Paid full bill' },
                    { name: 'Rohan Verma', share: Math.round(splitTotal / 3), badge: 'Owes you' },
                    { name: 'Priya Sharma', share: Math.round(splitTotal / 3), badge: 'Owes you' },
                  ].map((p, i) => (
                    <div
                      key={i}
                      className="p-3.5 rounded-2xl bg-[#101720] border border-[#1e2a3a] flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar name={p.name} size="sm" />
                        <div>
                          <div className="font-heading font-bold text-xs text-white">{p.name}</div>
                          <div className="text-[10px] text-[#8a99a8]">{p.badge}</div>
                        </div>
                      </div>
                      <span className="font-heading font-bold text-sm text-[#38d9d9]">₹{p.share.toLocaleString()}</span>
                    </div>
                  ))}
                </div>

                {splitSuccess ? (
                  <div className="p-3 rounded-2xl bg-[#07382d] border border-[#0d5945] text-[#34d399] font-bold text-xs flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      <span>2 bilateral agreements generated &amp; dispatched!</span>
                    </span>
                    <button type="button" onClick={() => setSplitSuccess(false)} className="underline cursor-pointer">
                      Reset
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSplitSuccess(true)}
                    className="w-full py-3 rounded-2xl bg-[#38d9d9] text-[#042124] font-bold text-xs hover:opacity-90 active:scale-98 transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">call_split</span>
                    <span>Generate Split Obligations (₹{Math.round(splitTotal / 3).toLocaleString()} each)</span>
                  </button>
                )}
              </div>
            )}

            {/* TAB CONTENT 7: ANALYTICS */}
            {activeTab === 'analytics' && (
              <div className="space-y-4 font-mono">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading font-extrabold text-sm text-white">Cashflow Recovery Performance</h3>
                  <div className="flex bg-[#141b24] p-1 rounded-xl border border-[#222e3d] text-xs">
                    {(['1M', '3M', '6M', '1Y'] as const).map((tf) => (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => setAnalyticsTf(tf)}
                        className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                          analyticsTf === tf ? 'bg-[#1c2635] text-[#38d9d9]' : 'text-[#8a99a8]'
                        }`}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="p-4 rounded-2xl bg-[#101720] border border-[#1e2a3a]">
                    <span className="text-[10px] text-[#8a99a8] uppercase font-bold">Total Recovered</span>
                    <div className="text-xl font-extrabold text-[#34d399] mt-1">
                      {analyticsTf === '1M' ? '₹8,500' : analyticsTf === '3M' ? '₹24,000' : '₹48,200'}
                    </div>
                    <span className="text-[10px] text-[#8a99a8]">74% recovery rate</span>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#101720] border border-[#1e2a3a]">
                    <span className="text-[10px] text-[#8a99a8] uppercase font-bold">Outstanding Capital</span>
                    <div className="text-xl font-extrabold text-[#f87171] mt-1">₹14,350</div>
                    <span className="text-[10px] text-[#8a99a8]">2 active debts</span>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#101720] border border-[#1e2a3a]">
                    <span className="text-[10px] text-[#8a99a8] uppercase font-bold">Average Settle Time</span>
                    <div className="text-xl font-extrabold text-[#38d9d9] mt-1">14.2 days</div>
                    <span className="text-[10px] text-[#8a99a8]">Punctual score 92%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Footer Note inside Window */}
            <div className="pt-3 border-t border-[#1e2634] flex items-center justify-between text-xs font-mono text-[#6f7f95]">
              <span className="flex items-center gap-2 text-[#34d399]">
                <span className="w-2 h-2 rounded-full bg-[#34d399] animate-pulse" />
                <span>DebtSync 16-Inch High-Fidelity Interactive Sandbox</span>
              </span>
              <span className="hidden sm:inline">Try toggling filters, buttons &amp; tabs above!</span>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
