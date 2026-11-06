'use client';

import React, { useState, useEffect } from 'react';

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

  // --- Sandbox State: Dashboard ---
  const [dashFilter, setDashFilter] = useState<'all' | 'lent' | 'borrowed'>('all');
  const [dashDebts, setDashDebts] = useState([
    {
      id: 'd1',
      title: 'MacBook Pro M3 Share',
      person: 'Rohan Verma',
      type: 'lent',
      principal: 20000,
      balance: 12000,
      apr: 10,
      interestType: 'Simple APR',
      dueDate: 'in 14 days',
      status: 'active',
    },
    {
      id: 'd2',
      title: 'Goa Roadtrip Airbnb',
      person: 'Priya Sharma',
      type: 'borrowed',
      principal: 4500,
      balance: 4500,
      apr: 0,
      interestType: '0% Interest',
      dueDate: 'in 28 days',
      status: 'active',
    },
  ]);
  const [dashToast, setDashToast] = useState<string | null>(null);

  // --- Sandbox State: Directory ---
  const [directorySearch, setDirectorySearch] = useState('');
  const [directoryFilter, setDirectoryFilter] = useState<'all' | 'active' | 'settled'>('all');
  const [directoryPeople, setDirectoryPeople] = useState([
    {
      id: 'p1',
      name: 'Rohan Verma',
      email: 'rohan.verma@example.com',
      lent: 12000,
      borrowed: 2000,
      net: 10000, // +10000 owed to you
      trustScore: 812,
      trustRating: 'Excellent',
      status: 'active',
    },
    {
      id: 'p2',
      name: 'Priya Sharma',
      email: 'priya.sharma@example.com',
      lent: 0,
      borrowed: 4500,
      net: -4500, // you owe 4500
      trustScore: 785,
      trustRating: 'Very Good',
      status: 'active',
    },
    {
      id: 'p3',
      name: 'Karan Mehta',
      email: 'karan.m@example.com',
      lent: 5000,
      borrowed: 5000,
      net: 0,
      trustScore: 840,
      trustRating: 'Exceptional',
      status: 'settled',
    },
  ]);
  const [directoryToast, setDirectoryToast] = useState<string | null>(null);

  // --- Sandbox State: Detail & Verification ---
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

  // --- Sandbox State: Reminders ---
  const [reminderType, setReminderType] = useState<'email' | 'push'>('email');
  const [emailQuota, setEmailQuota] = useState(1);
  const [pushQuota, setPushQuota] = useState(2);
  const [reminderDispatched, setReminderDispatched] = useState(false);

  // --- Sandbox State: Share ---
  const [sharePrivacyMode, setSharePrivacyMode] = useState<'public' | 'private'>('public');

  // --- Sandbox State: Split ---
  const [splitTotal, setSplitTotal] = useState(3600);
  const [splitPayer, setSplitPayer] = useState<'you' | 'rohan'>('you');
  const [splitSuccess, setSplitSuccess] = useState(false);

  // --- Sandbox State: Analytics ---
  const [analyticsTimeframe, setAnalyticsTimeframe] = useState<'1M' | '3M' | '6M' | '1Y'>('3M');

  // Reset triggers when changing tabs
  const resetTabDemos = () => {
    setDashDebts([
      {
        id: 'd1',
        title: 'MacBook Pro M3 Share',
        person: 'Rohan Verma',
        type: 'lent',
        principal: 20000,
        balance: 12000,
        apr: 10,
        interestType: 'Simple APR',
        dueDate: 'in 14 days',
        status: 'active',
      },
      {
        id: 'd2',
        title: 'Goa Roadtrip Airbnb',
        person: 'Priya Sharma',
        type: 'borrowed',
        principal: 4500,
        balance: 4500,
        apr: 0,
        interestType: '0% Interest',
        dueDate: 'in 28 days',
        status: 'active',
      },
    ]);
    setDashToast(null);
    setDirectoryPeople([
      {
        id: 'p1',
        name: 'Rohan Verma',
        email: 'rohan.verma@example.com',
        lent: 12000,
        borrowed: 2000,
        net: 10000,
        trustScore: 812,
        trustRating: 'Excellent',
        status: 'active',
      },
      {
        id: 'p2',
        name: 'Priya Sharma',
        email: 'priya.sharma@example.com',
        lent: 0,
        borrowed: 4500,
        net: -4500,
        trustScore: 785,
        trustRating: 'Very Good',
        status: 'active',
      },
      {
        id: 'p3',
        name: 'Karan Mehta',
        email: 'karan.m@example.com',
        lent: 5000,
        borrowed: 5000,
        net: 0,
        trustScore: 840,
        trustRating: 'Exceptional',
        status: 'settled',
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
    share: 'debt-sync.satya-nayak.dev/share?token=demo_gsh',
    split: 'debt-sync.satya-nayak.dev/split-bill',
    analytics: 'debt-sync.satya-nayak.dev/analytics',
  };

  return (
    <div className="w-full max-w-3xl mx-auto rounded-2xl overflow-hidden border border-[var(--outline-variant)]/40 bg-[var(--surface-container-lowest)] shadow-2xl transition-all">
      {/* Emulated Window Header / Chrome */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--outline-variant)]/20 bg-[var(--surface-container)]/80 backdrop-blur-md gap-2">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
        </div>

        {/* Emulated URL Bar */}
        <div className="flex-1 max-w-sm sm:max-w-md mx-auto flex items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-[var(--surface)] border border-[var(--outline-variant)]/25 text-[11px] font-mono text-[var(--on-surface-variant)] truncate">
          <span className="material-symbols-outlined text-[13px] text-emerald-500">lock</span>
          <span className="truncate">{urlPathMap[activeTab]}</span>
        </div>

        {/* Mode Toggle & Reset */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={resetTabDemos}
            title="Reset demo data"
            className="p-1 rounded-md text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] text-[11px] font-mono transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">refresh</span>
          </button>
          {fallbackScreenshotUrl && (
            <div className="hidden sm:flex bg-[var(--surface)] p-0.5 rounded-md border border-[var(--outline-variant)]/25 text-[10px] font-mono">
              <button
                type="button"
                onClick={() => setViewMode('interactive')}
                className={`px-2 py-0.5 rounded transition-all font-semibold ${
                  viewMode === 'interactive'
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-2xs'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                Sandbox
              </button>
              <button
                type="button"
                onClick={() => setViewMode('screenshot')}
                className={`px-2 py-0.5 rounded transition-all font-semibold ${
                  viewMode === 'screenshot'
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-2xs'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                Image
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Emulated Viewport Body */}
      {viewMode === 'screenshot' && fallbackScreenshotUrl ? (
        <div className="p-3 bg-[var(--surface)]">
          <img
            src={fallbackScreenshotUrl}
            alt="Static UI Screenshot"
            className="w-full h-auto rounded-xl object-contain max-h-[520px] mx-auto"
          />
        </div>
      ) : (
        <div className="p-3 sm:p-5 bg-[var(--surface)] min-h-[420px] flex flex-col justify-between selection:bg-[var(--primary)] selection:text-[var(--on-primary)]">
          {/* TAB 1: DASHBOARD EMULATOR */}
          {activeTab === 'dashboard' && (
            <div className="space-y-4 font-mono">
              {/* Emulated Mini Top Bar */}
              <div className="flex items-center justify-between pb-3 border-b border-[var(--outline-variant)]/20">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[var(--primary)]/15 text-[var(--primary)] font-bold flex items-center justify-center text-xs">
                    DS
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[var(--on-surface)]">Portfolio Overview</div>
                    <div className="text-[10px] text-[var(--on-surface-variant)]">Satya Nayak &bull; Personal Ledger</div>
                  </div>
                </div>
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Live Accrual Active</span>
                </div>
              </div>

              {/* Bento Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                  <div className="text-[10px] text-[var(--on-surface-variant)] uppercase font-semibold">Net Balance</div>
                  <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">+₹14,350</div>
                  <div className="text-[9px] text-[var(--on-surface-variant)]">Net Receivable</div>
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                  <div className="text-[10px] text-[var(--on-surface-variant)] uppercase font-semibold">You Lent</div>
                  <div className="text-base font-bold text-[var(--secondary)] mt-0.5">₹22,500</div>
                  <div className="text-[9px] text-[var(--on-surface-variant)]">2 debtors</div>
                </div>
                <div className="col-span-2 sm:col-span-1 p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                  <div className="text-[10px] text-[var(--on-surface-variant)] uppercase font-semibold">Live Daily APR</div>
                  <div className="text-base font-bold text-[var(--primary)] mt-0.5">+₹4.12 / day</div>
                  <div className="text-[9px] text-[var(--on-surface-variant)]">Simple & Compound</div>
                </div>
              </div>

              {/* Filter Tabs in Mini UI */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex bg-[var(--surface-container)] p-0.5 rounded-lg border border-[var(--outline-variant)]/20 text-[10px]">
                  {(['all', 'lent', 'borrowed'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDashFilter(t)}
                      className={`px-2 py-1 rounded capitalize font-bold transition-all ${
                        dashFilter === t
                          ? 'bg-[var(--surface)] text-[var(--primary)] shadow-2xs'
                          : 'text-[var(--on-surface-variant)]'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-[var(--on-surface-variant)]">
                  {dashDebts.filter((d) => dashFilter === 'all' || d.type === dashFilter).length} active agreements
                </span>
              </div>

              {/* Debt Cards */}
              <div className="space-y-2">
                {dashDebts
                  .filter((d) => dashFilter === 'all' || d.type === dashFilter)
                  .map((d) => (
                    <div
                      key={d.id}
                      className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 shadow-2xs space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-xs text-[var(--on-surface)]">{d.title}</div>
                          <div className="text-[10px] text-[var(--on-surface-variant)] flex items-center gap-1">
                            <span>with <strong className="text-[var(--on-surface)]">{d.person}</strong></span>
                            <span>&bull;</span>
                            <span className="text-[var(--primary)]">{d.interestType}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`font-bold text-sm ${d.type === 'lent' ? 'text-[var(--secondary)]' : 'text-[var(--error)]'}`}>
                            {d.type === 'lent' ? '+' : '-'}₹{d.balance.toLocaleString()}
                          </div>
                          <span className="text-[9px] text-[var(--on-surface-variant)]">Due {d.dueDate}</span>
                        </div>
                      </div>

                      {/* Interactive Action simulation */}
                      <div className="flex items-center justify-between pt-1 border-t border-[var(--outline-variant)]/15">
                        <span className="text-[9px] text-[var(--on-surface-variant)]">
                          Principal: ₹{d.principal.toLocaleString()} ({Math.round(((d.principal - d.balance) / d.principal) * 100)}% repaid)
                        </span>
                        {d.type === 'lent' && d.balance > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setDashDebts((prev) =>
                                prev.map((item) =>
                                  item.id === d.id ? { ...item, balance: Math.max(0, item.balance - 2000) } : item
                                )
                              );
                              setDashToast('Simulated ₹2,000 repayment recorded! Balance updated.');
                              setTimeout(() => setDashToast(null), 3500);
                            }}
                            className="px-2 py-0.8 rounded-md bg-[var(--primary)] text-[var(--on-primary)] text-[10px] font-bold hover:opacity-90 active:scale-95 transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[12px]">payments</span>
                            <span>Test Pay ₹2,000</span>
                          </button>
                        )}
                        {d.type === 'borrowed' && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">schedule</span>
                            <span>Awaiting repayment</span>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>

              {dashToast && (
                <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[10px] flex items-center gap-1.5 animate-fadeIn">
                  <span className="material-symbols-outlined text-[14px]">check_circle</span>
                  <span>{dashToast}</span>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DIRECTORY & BILATERAL LEDGERS EMULATOR */}
          {activeTab === 'directory' && (
            <div className="space-y-4 font-mono">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--outline-variant)]/20">
                <div>
                  <div className="text-xs font-bold text-[var(--on-surface)]">People & Bilateral Ledgers</div>
                  <div className="text-[10px] text-[var(--on-surface-variant)]">Automatic reciprocal debt offsetting</div>
                </div>
                <div className="text-[10px] text-[var(--primary)] font-bold">
                  3 Contacts &bull; Realtime Math
                </div>
              </div>

              {/* Search & Filter */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-2.5 top-2 text-[14px] text-[var(--on-surface-variant)]">
                    search
                  </span>
                  <input
                    type="text"
                    placeholder="Filter by name (e.g. Rohan)..."
                    value={directorySearch}
                    onChange={(e) => setDirectorySearch(e.target.value)}
                    className="w-full pl-7 pr-2 py-1 rounded-lg bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 text-xs text-[var(--on-surface)] outline-none"
                  />
                </div>
                <div className="flex bg-[var(--surface-container)] p-0.5 rounded-lg border border-[var(--outline-variant)]/20 text-[10px]">
                  {(['all', 'active', 'settled'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setDirectoryFilter(f)}
                      className={`px-2 py-0.5 rounded capitalize font-bold transition-all ${
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

              {/* Contact Cards */}
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
                      className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 shadow-2xs space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] font-bold text-xs flex items-center justify-center">
                            {p.name.slice(0, 1)}
                          </div>
                          <div>
                            <div className="font-bold text-xs text-[var(--on-surface)]">{p.name}</div>
                            <div className="text-[10px] text-[var(--on-surface-variant)]">{p.email}</div>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className={`font-bold text-xs ${p.net > 0 ? 'text-[var(--secondary)]' : p.net < 0 ? 'text-[var(--error)]' : 'text-[var(--on-surface-variant)]'}`}>
                            {p.net > 0 ? `+₹${p.net.toLocaleString()}` : p.net < 0 ? `-₹${Math.abs(p.net).toLocaleString()}` : 'Settled (₹0)'}
                          </div>
                          <div className="text-[9px] text-[var(--on-surface-variant)]">
                            Trust: <span className="font-bold text-emerald-600 dark:text-emerald-400">{p.trustScore}</span>
                          </div>
                        </div>
                      </div>

                      {/* Bilateral math row */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-[var(--outline-variant)]/15 text-[10px]">
                        <div className="text-[var(--on-surface-variant)]">
                          You lent: <span className="text-[var(--on-surface)]">₹{p.lent.toLocaleString()}</span> &bull; They lent: <span className="text-[var(--on-surface)]">₹{p.borrowed.toLocaleString()}</span>
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
                              setDirectoryToast(`1-Tap Settled with ${p.name}! Net balance balanced to ₹0.`);
                              setTimeout(() => setDirectoryToast(null), 3500);
                            }}
                            className="px-2.5 py-1 rounded-md bg-[var(--secondary)] text-[var(--on-secondary)] font-bold text-[10px] hover:opacity-90 active:scale-95 transition-all shadow-2xs flex items-center justify-center gap-1 cursor-pointer self-end sm:self-auto"
                          >
                            <span className="material-symbols-outlined text-[13px]">handshake</span>
                            <span>1-Tap Settle Net</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">check_circle</span>
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

          {/* TAB 3: DETAIL & RECEIPT VERIFICATION EMULATOR */}
          {activeTab === 'detail' && (
            <div className="space-y-4 font-mono">
              <div className="pb-3 border-b border-[var(--outline-variant)]/20">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-xs text-[var(--on-surface)]">MacBook Pro M3 Share</h4>
                    <p className="text-[10px] text-[var(--on-surface-variant)]">Lender: Satya Nayak &bull; Borrower: Rohan Verma</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30">
                    Active Consensus
                  </span>
                </div>
              </div>

              {/* Live Interest Breakdown */}
              <div className="p-3 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-[10px] text-[var(--on-surface-variant)]">Original Principal</div>
                  <div className="font-bold text-[var(--on-surface)] mt-0.5">₹20,000.00</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--on-surface-variant)]">Remaining Balance</div>
                  <div className="font-bold text-[var(--secondary)] mt-0.5">₹12,000.00</div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <div className="text-[10px] text-[var(--on-surface-variant)]">Live Accrued Interest</div>
                  <div className="font-bold text-[var(--primary)] mt-0.5 font-mono">
                    +₹{accruedSeconds.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Payment Timeline & Interactive Verification */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-[var(--on-surface)] flex items-center justify-between">
                  <span>Repayment Audit Timeline</span>
                  <span className="text-[9px] text-[var(--on-surface-variant)]">Try clicking &quot;Verify Receipt&quot; below!</span>
                </div>

                <div className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-[var(--on-surface)]">₹4,000.00 via UPI</div>
                      <div className="text-[10px] text-[var(--on-surface-variant)]">Ref: UPI/9823481239 &bull; Nov 05, 2026</div>
                    </div>

                    {isReceiptVerified ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold border border-emerald-500/30">
                        <span className="material-symbols-outlined text-[13px]">verified</span>
                        <span>Verified by Lender</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsReceiptVerified(true)}
                        className="px-3 py-1 rounded-md bg-[var(--primary)] text-[var(--on-primary)] font-bold text-[10px] hover:opacity-90 active:scale-95 transition-all shadow-xs flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[13px]">done_all</span>
                        <span>Verify Receipt (1-Tap)</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Two-Sided Notes Inspection */}
                <div className="p-3 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase text-[var(--on-surface-variant)]">
                      Two-Sided Notes
                    </span>
                    <div className="flex bg-[var(--surface-container)] p-0.5 rounded text-[10px]">
                      <button
                        type="button"
                        onClick={() => setActiveNoteTab('my')}
                        className={`px-2 py-0.5 rounded transition-all font-semibold ${
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
                        className={`px-2 py-0.5 rounded transition-all font-semibold ${
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

          {/* TAB 4: REMINDERS & QUOTA EMULATOR */}
          {activeTab === 'reminders' && (
            <div className="space-y-4 font-mono">
              <div className="pb-3 border-b border-[var(--outline-variant)]/20 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-[var(--on-surface)]">Polite Payment Reminders</div>
                  <div className="text-[10px] text-[var(--on-surface-variant)]">Spam-protected rolling weekly quotas</div>
                </div>
                <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20">
                  Rate-Limited
                </span>
              </div>

              {/* Quotas Monitor */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                  <div className="text-[10px] text-[var(--on-surface-variant)] uppercase font-semibold">Email Quota</div>
                  <div className="text-sm font-bold text-[var(--on-surface)] mt-0.5">
                    {emailQuota} of 2 available
                  </div>
                  <div className="w-full bg-[var(--surface-container-high)] h-1.5 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className="bg-purple-500 h-full rounded-full transition-all"
                      style={{ width: `${(emailQuota / 2) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                  <div className="text-[10px] text-[var(--on-surface-variant)] uppercase font-semibold">Push Quota</div>
                  <div className="text-sm font-bold text-[var(--on-surface)] mt-0.5">
                    {pushQuota} of 3 available
                  </div>
                  <div className="w-full bg-[var(--surface-container-high)] h-1.5 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className="bg-teal-500 h-full rounded-full transition-all"
                      style={{ width: `${(pushQuota / 3) * 100}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Channel Selector */}
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setReminderType('email')}
                  className={`flex-1 p-2.5 rounded-xl border flex items-center justify-center gap-1.5 font-bold transition-all ${
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
                  className={`flex-1 p-2.5 rounded-xl border flex items-center justify-center gap-1.5 font-bold transition-all ${
                    reminderType === 'push'
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)] shadow-xs'
                      : 'bg-[var(--surface-container-low)] text-[var(--on-surface)] border-[var(--outline-variant)]/30'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">notifications_active</span>
                  <span>Web Push Alert</span>
                </button>
              </div>

              {/* Preview Message Card */}
              <div className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 text-xs space-y-1.5">
                <div className="text-[10px] text-[var(--on-surface-variant)] font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px] text-emerald-500">verified</span>
                  <span>Live Preview &bull; To: rohan.verma@example.com</span>
                </div>
                <div className="text-[11px] font-bold text-[var(--on-surface)]">
                  Friendly reminder regarding MacBook Pro M3 share (₹12,000 due)
                </div>
                <p className="text-[10px] text-[var(--on-surface-variant)] leading-relaxed">
                  Hi Rohan, this is an automated courtesy reminder from Satya via DebtSync. An obligation of ₹12,000 is upcoming in 14 days.
                </p>
              </div>

              {/* Interactive Dispatch Button */}
              {reminderDispatched ? (
                <div className="p-2.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-700 dark:text-purple-300 text-xs font-bold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">task_alt</span>
                    <span>Reminder successfully queued &amp; dispatched!</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReminderDispatched(false);
                      setEmailQuota(1);
                      setPushQuota(2);
                    }}
                    className="text-[10px] underline cursor-pointer"
                  >
                    Reset Quota
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (reminderType === 'email') setEmailQuota((q) => Math.max(0, q - 1));
                    if (reminderType === 'push') setPushQuota((q) => Math.max(0, q - 1));
                    setReminderDispatched(true);
                  }}
                  className="w-full py-2.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-bold text-xs hover:opacity-90 active:scale-98 transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">send</span>
                  <span>Test Dispatch {reminderType === 'email' ? 'Email' : 'Push'} (Quota-Safe)</span>
                </button>
              )}
            </div>
          )}

          {/* TAB 5: DUAL SHARE LINKS EMULATOR */}
          {activeTab === 'share' && (
            <div className="space-y-4 font-mono">
              <div className="pb-3 border-b border-[var(--outline-variant)]/20 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-[var(--on-surface)]">Dual Share Modes</div>
                  <div className="text-[10px] text-[var(--on-surface-variant)]">Public privacy-masked vs private authenticated</div>
                </div>
                <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full border border-teal-500/20">
                  Cryptographic Tokens
                </span>
              </div>

              {/* Mode Toggle Switch */}
              <div className="flex bg-[var(--surface-container)] p-1 rounded-xl border border-[var(--outline-variant)]/25 text-xs">
                <button
                  type="button"
                  onClick={() => setSharePrivacyMode('public')}
                  className={`flex-1 py-1.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all ${
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
                  className={`flex-1 py-1.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all ${
                    sharePrivacyMode === 'private'
                      ? 'bg-[var(--surface)] text-[var(--primary)] shadow-xs'
                      : 'text-[var(--on-surface-variant)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">lock</span>
                  <span>Private Member Link</span>
                </button>
              </div>

              {/* Preview of what the viewer sees */}
              <div className="p-3.5 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--on-surface-variant)]">
                    Simulated Viewer Receipt
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                    sharePrivacyMode === 'public'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {sharePrivacyMode === 'public' ? 'Emails Masked & Notes Stripped' : 'Full Authenticated Ledger'}
                  </span>
                </div>

                <div className="space-y-1.5 bg-[var(--surface)] p-2.5 rounded-lg border border-[var(--outline-variant)]/20">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--on-surface-variant)]">Agreement:</span>
                    <strong className="text-[var(--on-surface)]">MacBook Pro M3 Share</strong>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--on-surface-variant)]">Borrower:</span>
                    <span className="font-mono font-bold text-[var(--on-surface)]">
                      {sharePrivacyMode === 'public' ? 'r***a@example.com' : 'rohan.verma@example.com'}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--on-surface-variant)]">Remaining Balance:</span>
                    <span className="font-bold text-[var(--secondary)]">₹12,000.00</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--on-surface-variant)]">Agreement Notes:</span>
                    <span className="italic text-[10px] text-[var(--on-surface-variant)]">
                      {sharePrivacyMode === 'public' ? '[Withheld on Public Link]' : 'Approved simple APR at 10%'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Copy URL trigger */}
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
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 6: GROUP SPLIT EMULATOR */}
          {activeTab === 'split' && (
            <div className="space-y-4 font-mono">
              <div className="pb-3 border-b border-[var(--outline-variant)]/20 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-[var(--on-surface)]">Group Bill Splitter</div>
                  <div className="text-[10px] text-[var(--on-surface-variant)]">Instant individual shares &amp; consensus</div>
                </div>
                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                  Fair Division
                </span>
              </div>

              {/* Total Amount Selector */}
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                <span className="text-xs text-[var(--on-surface-variant)] font-semibold">Total Bill Amount</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSplitTotal((t) => Math.max(900, t - 300))}
                    className="w-6 h-6 rounded bg-[var(--surface)] border border-[var(--outline-variant)]/30 font-bold text-xs flex items-center justify-center hover:bg-[var(--surface-container)]"
                  >
                    -
                  </button>
                  <span className="text-sm font-bold text-[var(--on-surface)] px-2">₹{splitTotal.toLocaleString()}</span>
                  <button
                    type="button"
                    onClick={() => setSplitTotal((t) => t + 300)}
                    className="w-6 h-6 rounded bg-[var(--surface)] border border-[var(--outline-variant)]/30 font-bold text-xs flex items-center justify-center hover:bg-[var(--surface-container)]"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Participants list (3 people) */}
              <div className="space-y-1.5 text-xs">
                {[
                  { name: 'You (Payer)', share: Math.round(splitTotal / 3), tag: 'Paid the bill' },
                  { name: 'Rohan Verma', share: Math.round(splitTotal / 3), tag: 'Owes you' },
                  { name: 'Priya Sharma', share: Math.round(splitTotal / 3), tag: 'Owes you' },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded-lg bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/25 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] font-bold text-[10px] flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div>
                        <div className="font-bold text-xs text-[var(--on-surface)]">{item.name}</div>
                        <div className="text-[9px] text-[var(--on-surface-variant)]">{item.tag}</div>
                      </div>
                    </div>
                    <span className="font-bold text-xs text-[var(--primary)]">₹{item.share.toLocaleString()}</span>
                  </div>
                ))}
              </div>

              {splitSuccess ? (
                <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    <span>2 peer debt proposals created &amp; dispatched!</span>
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
                  <span className="material-symbols-outlined text-[16px]">call_split</span>
                  <span>Create Group Split (₹{Math.round(splitTotal / 3).toLocaleString()} each)</span>
                </button>
              )}
            </div>
          )}

          {/* TAB 7: CASHFLOW ANALYTICS EMULATOR */}
          {activeTab === 'analytics' && (
            <div className="space-y-4 font-mono">
              <div className="pb-3 border-b border-[var(--outline-variant)]/20 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-[var(--on-surface)]">Portfolio Insights</div>
                  <div className="text-[10px] text-[var(--on-surface-variant)]">Dynamic cashflow &amp; recovery projection</div>
                </div>
                {/* Timeframe switch */}
                <div className="flex bg-[var(--surface-container)] p-0.5 rounded-lg border border-[var(--outline-variant)]/25 text-[10px]">
                  {(['1M', '3M', '6M', '1Y'] as const).map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setAnalyticsTimeframe(tf)}
                      className={`px-2 py-0.5 rounded font-bold transition-all ${
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

              {/* Metric stats */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                  <div className="text-[10px] text-[var(--on-surface-variant)]">Recovered</div>
                  <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {analyticsTimeframe === '1M' ? '₹8,500' : analyticsTimeframe === '3M' ? '₹24,000' : '₹48,200'}
                  </div>
                  <div className="text-[9px] text-[var(--on-surface-variant)]">74% rate</div>
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                  <div className="text-[10px] text-[var(--on-surface-variant)]">Outstanding</div>
                  <div className="text-sm font-bold text-[var(--error)] mt-0.5">₹14,350</div>
                  <div className="text-[9px] text-[var(--on-surface-variant)]">2 active</div>
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30">
                  <div className="text-[10px] text-[var(--on-surface-variant)]">Avg Settle</div>
                  <div className="text-sm font-bold text-[var(--primary)] mt-0.5">14.2 days</div>
                  <div className="text-[9px] text-[var(--on-surface-variant)]">Punctual</div>
                </div>
              </div>

              {/* Simulated Interactive SVG Bar Chart */}
              <div className="p-3 rounded-xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 space-y-2">
                <div className="flex items-center justify-between text-[10px] text-[var(--on-surface-variant)]">
                  <span>Monthly Repayment Volumes</span>
                  <span className="text-emerald-500 font-bold">&uarr; +18.4% vs last period</span>
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
                        className="w-full bg-[var(--primary)] hover:bg-[var(--secondary)] rounded-t-md transition-all duration-300"
                        style={{ height: bar.height }}
                      />
                      <span className="text-[9px] text-[var(--on-surface-variant)]">{bar.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Footer note inside emulator */}
          <div className="pt-3 mt-3 border-t border-[var(--outline-variant)]/15 flex items-center justify-between text-[10px] font-mono text-[var(--on-surface-variant)]">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              <span>Interactive In-Browser Simulation</span>
            </span>
            <span className="hidden sm:inline">Try clicking buttons, switches &amp; filters above!</span>
          </div>
        </div>
      )}
    </div>
  );
}
