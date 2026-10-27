'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PublicNav } from '@/components/layout/PublicNav';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { getCachedUserProfile } from '@/lib/utils/auth-session';
import { createClient } from '@/lib/supabase/client';

const SAMPLE_PUBLIC_SHARE_URL =
  'https://debt-sync.satya-nayak.dev/share?id=81d9115e-d237-49eb-8be5-16bb3a9ea408&token=gsh_hitjra5bqn7dy2tsdf';

function LandingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Check if URL has ?home=true, ?stay=true, or ?preview=true
  const hasHomeParam =
    searchParams.get('home') === 'true' ||
    searchParams.get('stay') === 'true' ||
    searchParams.get('preview') === 'true';

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userProfile, setUserProfile] = useState<{ full_name?: string; email?: string } | null>(null);
  const [activeScreenshotTab, setActiveScreenshotTab] = useState<'dashboard' | 'reminders' | 'share' | 'split' | 'analytics' | 'detail'>('dashboard');
  const [isThemeDark, setIsThemeDark] = useState(true);

  // Synchronize sessionStorage public viewing state
  useEffect(() => {
    if (hasHomeParam) {
      try {
        sessionStorage.setItem('debtsync_viewing_public_site', 'true');
      } catch (_) {}
    }
  }, [hasHomeParam]);

  useEffect(() => {
    // Read current theme from DOM
    if (typeof document !== 'undefined') {
      setIsThemeDark(document.documentElement.classList.contains('dark'));
      const observer = new MutationObserver(() => {
        setIsThemeDark(document.documentElement.classList.contains('dark'));
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      return () => observer.disconnect();
    }
  }, []);

  useEffect(() => {
    const isPublicSession =
      hasHomeParam ||
      (typeof window !== 'undefined' && sessionStorage.getItem('debtsync_viewing_public_site') === 'true');

    // 0ms cached session check
    const cached = getCachedUserProfile();
    if (cached) {
      setIsLoggedIn(true);
      setUserProfile({ full_name: cached.full_name, email: cached.email });

      // Returning logged-in users visiting the root URL are sent directly to their dashboard
      // UNLESS they are in public browsing mode (?home=true or active public viewing session)
      if (!isPublicSession) {
        router.replace('/dash');
        return;
      }
    }

    // Verify session
    const supabase = createClient();
    supabase.auth.getSession().then((res: any) => {
      const session = res?.data?.session;
      if (session?.user) {
        setIsLoggedIn(true);
        setUserProfile({
          full_name: session.user.user_metadata?.full_name,
          email: session.user.email,
        });

        if (!isPublicSession) {
          router.replace('/dash');
        }
      }
    });
  }, [router, hasHomeParam]);

  const clearPublicSession = () => {
    try {
      sessionStorage.removeItem('debtsync_viewing_public_site');
    } catch (_) {}
  };

  const screenshots = {
    dashboard: {
      desktop: isThemeDark ? '/screenshots/dashboard-desktop.png' : '/screenshots/dashboard-light.png',
      mobile: isThemeDark ? '/screenshots/dashboard-mobile.png' : '/screenshots/dashboard-light-mobile.png',
      title: 'Real-Time Portfolio & Balances',
      desc: 'Live financial position overview, daily interest accrual tickers, active agreement cards, and quick repayment access.',
      tag: 'Desktop & Phone PWA',
    },
    detail: {
      desktop: '/screenshots/debt-detail-upscroll-desktop.png',
      mobile: '/screenshots/debt-detail-downscroll-desktop.png',
      title: 'Agreement Audit Trail & Receipts',
      desc: 'Immutable timeline of every repayment, verified receipts, interest breakdown, and two-sided personal notes.',
      tag: 'Mutual Verification',
    },
    reminders: {
      desktop: '/screenshots/reminders-mobile.png',
      mobile: '/screenshots/reminders-mobile.png',
      title: 'Automated & Rate-Limited Reminders',
      desc: 'Lenders can dispatch polite payment reminders via Email (max 2/wk) and Web Push (max 3/wk) + automated 1-day due date alerts.',
      tag: 'Quota-Protected',
    },
    share: {
      desktop: '/screenshots/share-public-mobile.png',
      mobile: '/screenshots/share-public-mobile.png',
      title: 'Dual Share Links (Public & Private)',
      desc: 'Share public links with masked emails and hidden notes for anyone to view without login, or private links restricted to participants.',
      tag: 'Privacy Shielded',
    },
    split: {
      desktop: '/screenshots/split-bill-mobile.png',
      mobile: '/screenshots/split-bill-mobile.png',
      title: 'Group Expense Splitting',
      desc: 'Divide group meals, rent, and trips with clear individual participant shares, payer tags, and mutual settlement.',
      tag: 'Group Dinners & Trips',
    },
    analytics: {
      desktop: '/screenshots/analytics-desktop-scrollup.png',
      mobile: '/screenshots/analytics-desktop-scrolldown.png',
      title: 'Cashflow Insights & Projections',
      desc: 'Deep analytics tracking outstanding loans, cumulative repayments, net portfolio trajectory, and historical settlement metrics.',
      tag: 'Visual Analytics',
    },
  };

  const currentShot = screenshots[activeScreenshotTab];

  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--on-surface)] flex flex-col selection:bg-[var(--primary)] selection:text-[var(--on-primary)] transition-colors">
      {/* Logged-in Quick Return Banner */}
      {isLoggedIn && (
        <div className="bg-gradient-to-r from-[var(--primary)]/15 via-teal-500/10 to-transparent border-b border-[var(--primary)]/20 px-4 py-2 font-mono text-xs flex items-center justify-between gap-3 text-[var(--on-surface)]">
          <div className="flex items-center gap-2 truncate">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
            <span className="truncate">
              Signed in as <strong className="text-[var(--primary)]">{userProfile?.full_name || userProfile?.email || 'User'}</strong>
            </span>
          </div>
          <Link
            href="/dash"
            onClick={clearPublicSession}
            className="px-3.5 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] font-bold shrink-0 hover:opacity-90 active:scale-95 transition-all flex items-center gap-1 text-[11px] shadow-xs cursor-pointer min-h-[32px]"
          >
            <span>Open Dashboard</span>
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </Link>
        </div>
      )}

      <PublicNav currentPath="/" />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden pt-12 pb-20 md:pt-20 md:pb-28">
          {/* Subtle Ambient Glow */}
          <div
            className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-[var(--primary)]/15 via-teal-500/10 to-transparent blur-3xl pointer-events-none rounded-full"
            aria-hidden="true"
          />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
            {/* Open Source / Version Badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/40 font-mono text-xs text-[var(--on-surface-variant)] mb-8 shadow-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-semibold text-[var(--on-surface)]">DebtSync v0.1</span>
              <span>•</span>
              <a
                href="https://github.com/Satya-Siba-Nayak/Debt-Sync"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline font-bold inline-flex items-center gap-1"
              >
                <span>Open Source on GitHub</span>
                <span className="material-symbols-outlined text-[13px]">open_in_new</span>
              </a>
            </div>

            {/* Main Headline */}
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-[var(--on-surface)] max-w-4xl mx-auto leading-tight">
              Synced Ledgers.{' '}
              <span className="bg-gradient-to-r from-[var(--primary)] via-teal-400 to-emerald-400 bg-clip-text text-transparent">
                Zero Friction.
              </span>
            </h1>

            {/* Tagline */}
            <p className="mt-6 text-base sm:text-lg md:text-xl text-[var(--on-surface-variant)] max-w-2xl mx-auto leading-relaxed">
              The collaborative peer-to-peer ledger and interest engine. Track personal loans, split group expenses, calculate compounding APR to the second, and verify repayments without awkwardness.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3.5">
              {isLoggedIn ? (
                <Link
                  href="/dash"
                  onClick={clearPublicSession}
                  className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-sm font-bold hover:opacity-90 active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 min-h-[48px]"
                >
                  <span className="material-symbols-outlined text-[18px]">dashboard</span>
                  <span>Open Your Dashboard</span>
                </Link>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-sm font-bold hover:opacity-90 active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 min-h-[48px]"
                  >
                    <span>Create Free Account</span>
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </Link>
                  <Link
                    href="/login"
                    className="w-full sm:w-auto px-6 py-3.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] font-mono text-sm font-semibold transition-colors flex items-center justify-center min-h-[48px]"
                  >
                    Sign In
                  </Link>
                </>
              )}

              <a
                href={SAMPLE_PUBLIC_SHARE_URL}
                target="_blank"
                rel="noopener noreferrer"
                title="Open a read-only sample of a public share receipt"
                className="w-full sm:w-auto px-6 py-3.5 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/10 hover:bg-[var(--primary)]/15 text-[var(--primary)] font-mono text-sm font-bold transition-colors flex items-center justify-center gap-2 min-h-[48px]"
              >
                <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                <span>View Sample Public Receipt (Demo)</span>
              </a>
            </div>

            {/* Trust Points */}
            <div className="mt-12 pt-8 border-t border-[var(--outline-variant)]/20 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono text-[var(--on-surface-variant)] max-w-4xl mx-auto">
              <div className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-emerald-500">verified_user</span>
                <span>Mutual Consensus</span>
              </div>
              <div className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-blue-500">schedule</span>
                <span>Live Second-by-Second APR</span>
              </div>
              <div className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-purple-500">notifications_active</span>
                <span>Quota-Limited Reminders</span>
              </div>
              <div className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-amber-500">lock</span>
                <span>Zero Ads • Open Source</span>
              </div>
            </div>

            {/* Hero Main Mockup Frame */}
            <div className="mt-14 relative mx-auto max-w-5xl rounded-2xl border border-[var(--outline-variant)]/30 bg-[var(--surface-container-lowest)] p-2 sm:p-3 shadow-2xl">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--outline-variant)]/20 mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                </div>
                <div className="font-mono text-[11px] text-[var(--on-surface-variant)] px-3 py-1 rounded-md bg-[var(--surface-container)] flex items-center gap-1.5 truncate max-w-xs sm:max-w-md">
                  <span className="material-symbols-outlined text-[13px] text-emerald-500">lock</span>
                  <span>debt-sync.satya-nayak.dev/dash</span>
                </div>
                <div className="w-12" />
              </div>

              <div className="relative rounded-xl overflow-hidden border border-[var(--outline-variant)]/20 bg-[var(--surface-container)]">
                <img
                  src={isThemeDark ? '/screenshots/dashboard-desktop.png' : '/screenshots/dashboard-light.png'}
                  alt="DebtSync Portfolio Dashboard"
                  className="w-full h-auto object-cover"
                  loading="eager"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Core Features Grid */}
        <section id="features" className="py-20 bg-[var(--surface-container-low)] border-y border-[var(--outline-variant)]/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="font-heading text-xs font-bold text-[var(--primary)] uppercase tracking-wider mb-2 font-mono">
                Architected for Transparency
              </h2>
              <p className="font-heading text-3xl sm:text-4xl font-extrabold text-[var(--on-surface)] tracking-tight">
                Everything you need to keep peer finances crystal clear.
              </p>
              <p className="mt-3 text-sm text-[var(--on-surface-variant)] font-mono">
                No messy spreadsheets, forgotten IOU messages, or awkward confrontations.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div className="p-6 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-3 shadow-xs hover:border-[var(--primary)]/40 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">handshake</span>
                </div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Two-Sided Agreement Consensus
                </h3>
                <p className="text-xs font-mono text-[var(--on-surface-variant)] leading-relaxed">
                  Agreements start as pending proposals. Borrowers review terms, interest rates, and notes before accepting. Both sides maintain full auditability.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="p-6 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-3 shadow-xs hover:border-[var(--primary)]/40 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">calculate</span>
                </div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Precision Second-by-Second APR
                </h3>
                <p className="text-xs font-mono text-[var(--on-surface-variant)] leading-relaxed">
                  Support for Simple and Compound interest engines. Interest is computed down to the second with live tickers and transparent breakdown of principal vs accrued interest.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-6 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-3 shadow-xs hover:border-[var(--primary)]/40 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-500 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">alarm</span>
                </div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Lender Reminders &amp; Due Date Alerts
                </h3>
                <p className="text-xs font-mono text-[var(--on-surface-variant)] leading-relaxed">
                  Lenders can trigger reminders with strict rolling weekly quotas (Email max 2/wk, Push max 3/wk) to prevent spam, plus automated 1-day due date notifications.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="p-6 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-3 shadow-xs hover:border-[var(--primary)]/40 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-500 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">share</span>
                </div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Dual Sharing (Public &amp; Private)
                </h3>
                <p className="text-xs font-mono text-[var(--on-surface-variant)] leading-relaxed">
                  Share read-only public receipts with masked emails and hidden notes for anyone to view without logging in, or private cryptographic links restricted to verified members.
                </p>
              </div>

              {/* Feature 5 */}
              <div className="p-6 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-3 shadow-xs hover:border-[var(--primary)]/40 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">call_split</span>
                </div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Group Expense Splitting
                </h3>
                <p className="text-xs font-mono text-[var(--on-surface-variant)] leading-relaxed">
                  Split dinners, group trips, and shared household bills across any number of participants with individual share amounts and designated bill payer tags.
                </p>
              </div>

              {/* Feature 6 */}
              <div className="p-6 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-3 shadow-xs hover:border-[var(--primary)]/40 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">install_mobile</span>
                </div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Progressive Web App (PWA)
                </h3>
                <p className="text-xs font-mono text-[var(--on-surface-variant)] leading-relaxed">
                  Install straight to iOS Safari or Android Chrome home screens. Frame-0 instant load from persistent caches, full offline shell, and Web Push notifications.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Interactive App Previews & Screenshots Section */}
        <section id="screenshots" className="py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-12">
              <h2 className="font-heading text-xs font-bold text-[var(--primary)] uppercase tracking-wider mb-2 font-mono">
                Visual Walkthrough
              </h2>
              <p className="font-heading text-3xl sm:text-4xl font-extrabold text-[var(--on-surface)] tracking-tight">
                Designed for precision on every screen.
              </p>
              <p className="mt-3 text-sm text-[var(--on-surface-variant)] font-mono">
                Explore real interface captures across desktop and mobile viewports.
              </p>
            </div>

            {/* Tab Selectors */}
            <div className="flex flex-wrap items-center justify-center gap-2 mb-10 font-mono text-xs">
              {[
                { id: 'dashboard', label: 'Portfolio Dashboard', icon: 'dashboard' },
                { id: 'detail', label: 'Audit Trail & Receipts', icon: 'receipt_long' },
                { id: 'reminders', label: 'Payment Reminders', icon: 'alarm' },
                { id: 'share', label: 'Public Share Links', icon: 'public' },
                { id: 'split', label: 'Split Bills', icon: 'call_split' },
                { id: 'analytics', label: 'Cashflow Analytics', icon: 'analytics' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveScreenshotTab(tab.id as any)}
                  className={`px-4 py-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all min-h-[44px] ${
                    activeScreenshotTab === tab.id
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)] font-bold shadow-xs'
                      : 'border-[var(--outline-variant)]/30 bg-[var(--surface-container)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)] font-semibold'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Showcase Stage */}
            <div className="bg-[var(--surface-container-low)] rounded-3xl border border-[var(--outline-variant)]/30 p-6 md:p-10 shadow-lg">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                {/* Information Column */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30">
                    <span className="material-symbols-outlined text-[13px]">verified</span>
                    <span>{currentShot.tag}</span>
                  </div>
                  <h3 className="font-heading text-2xl sm:text-3xl font-extrabold text-[var(--on-surface)] leading-snug">
                    {currentShot.title}
                  </h3>
                  <p className="font-mono text-xs sm:text-sm text-[var(--on-surface-variant)] leading-relaxed">
                    {currentShot.desc}
                  </p>

                  <div className="pt-4 flex flex-wrap items-center gap-3">
                    {isLoggedIn ? (
                      <Link
                        href="/dash"
                        onClick={clearPublicSession}
                        className="px-5 py-2.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 transition-opacity min-h-[44px] inline-flex items-center gap-1.5 shadow-xs"
                      >
                        <span className="material-symbols-outlined text-[15px]">dashboard</span>
                        <span>Open Your Dashboard</span>
                      </Link>
                    ) : (
                      <Link
                        href="/signup"
                        className="px-5 py-2.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 transition-opacity min-h-[44px] inline-flex items-center gap-1.5 shadow-xs"
                      >
                        <span>Try DebtSync Now</span>
                        <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                      </Link>
                    )}
                    <a
                      href={SAMPLE_PUBLIC_SHARE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 hover:bg-[var(--surface-container)] font-mono text-xs font-semibold text-[var(--on-surface)] min-h-[44px] inline-flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[15px]">receipt_long</span>
                      <span>Sample Public Receipt</span>
                    </a>
                  </div>
                </div>

                {/* Screenshot Display Column */}
                <div className="lg:col-span-7 flex justify-center">
                  <div className="w-full max-w-2xl rounded-2xl overflow-hidden border border-[var(--outline-variant)]/40 bg-[var(--surface)] shadow-2xl p-2 sm:p-3">
                    <img
                      src={currentShot.desktop}
                      alt={currentShot.title}
                      className="w-full h-auto rounded-xl object-contain max-h-[540px] mx-auto"
                      loading="lazy"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works in 3 Steps */}
        <section id="how-it-works" className="py-20 bg-[var(--surface-container-low)] border-y border-[var(--outline-variant)]/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="font-heading text-xs font-bold text-[var(--primary)] uppercase tracking-wider mb-2 font-mono">
                Simple Workflow
              </h2>
              <p className="font-heading text-3xl sm:text-4xl font-extrabold text-[var(--on-surface)] tracking-tight">
                How DebtSync Works in 3 Steps
              </p>
              <p className="mt-3 text-sm text-[var(--on-surface-variant)] font-mono">
                No complex bookkeeping. Just mutual agreement and automatic synchronization.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Step 1 */}
              <div className="p-6 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-4 shadow-xs relative">
                <div className="w-10 h-10 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono font-extrabold flex items-center justify-center text-sm shadow-sm">
                  01
                </div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Record Agreement
                </h3>
                <p className="text-xs font-mono text-[var(--on-surface-variant)] leading-relaxed">
                  Specify whether you lent or borrowed, set the principal, select optional interest (Simple or Compound APR), choose a due date, and attach agreement notes.
                </p>
              </div>

              {/* Step 2 */}
              <div className="p-6 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-4 shadow-xs relative">
                <div className="w-10 h-10 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono font-extrabold flex items-center justify-center text-sm shadow-sm">
                  02
                </div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Counterparty Accepts
                </h3>
                <p className="text-xs font-mono text-[var(--on-surface-variant)] leading-relaxed">
                  Your peer receives an instant email notification or acceptance link. They review the terms and accept. Once agreed, the transaction transitions to Active.
                </p>
              </div>

              {/* Step 3 */}
              <div className="p-6 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-4 shadow-xs relative">
                <div className="w-10 h-10 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono font-extrabold flex items-center justify-center text-sm shadow-sm">
                  03
                </div>
                <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
                  Track &amp; Verify Repayments
                </h3>
                <p className="text-xs font-mono text-[var(--on-surface-variant)] leading-relaxed">
                  Borrower submits repayments with payment method tags (UPI, Cash, Bank Transfer). Lender verifies receipt with 1 tap until balance is fully settled.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Live Public Share Link Demo Showcase */}
        <section id="live-demo" className="py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="p-8 md:p-12 rounded-3xl bg-gradient-to-br from-[var(--surface-container)] via-[var(--surface-container-low)] to-[var(--surface)] border border-[var(--primary)]/30 shadow-xl space-y-6">
              <div className="max-w-3xl space-y-3">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-blue-500/15 text-blue-500 border border-blue-500/30">
                  <span className="material-symbols-outlined text-[13px]">receipt_long</span>
                  <span>Public Share Receipt Example</span>
                </div>
                <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-[var(--on-surface)]">
                  Inspect a Live Public Share Receipt
                </h2>
                <p className="font-mono text-xs sm:text-sm text-[var(--on-surface-variant)] leading-relaxed">
                  Notice: this live sample link is specifically a demonstration of a <strong>read-only Public Share Receipt</strong>. It showcases how DebtSync enables lenders and borrowers to provide verified ledger proof to outside parties without compromising account security: sensitive emails are masked (<span className="text-[var(--primary)]">s***k@domain.com</span>), private counterparty notes remain withheld, and transaction controls are disabled.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                <a
                  href={SAMPLE_PUBLIC_SHARE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 min-h-[48px]"
                >
                  <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                  <span>Open Sample Public Receipt</span>
                </a>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(SAMPLE_PUBLIC_SHARE_URL);
                    alert('Sample receipt share link copied to clipboard!');
                  }}
                  className="px-5 py-3.5 rounded-xl border border-[var(--outline-variant)]/40 hover:bg-[var(--surface-container-high)] font-mono text-xs font-semibold text-[var(--on-surface)] flex items-center justify-center gap-1.5 min-h-[48px] cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">content_copy</span>
                  <span>Copy Receipt Link</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Frequently Asked Questions (FAQ) */}
        <section id="faq" className="py-20 bg-[var(--surface-container-low)] border-t border-[var(--outline-variant)]/20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="font-heading text-xs font-bold text-[var(--primary)] uppercase tracking-wider mb-2 font-mono">
                Got Questions?
              </h2>
              <p className="font-heading text-3xl sm:text-4xl font-extrabold text-[var(--on-surface)] tracking-tight">
                Frequently Asked Questions
              </p>
            </div>

            <div className="space-y-4 font-mono text-xs">
              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-2">
                <h3 className="font-heading text-sm font-bold text-[var(--on-surface)]">
                  Is DebtSync free to use?
                </h3>
                <p className="text-[var(--on-surface-variant)] leading-relaxed">
                  Yes, DebtSync is completely free and open-source under the MIT license. You can sign up, track unlimited peer ledgers, calculate interest, and send notifications without paying a subscription.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-2">
                <h3 className="font-heading text-sm font-bold text-[var(--on-surface)]">
                  Does DebtSync move real money or process payments?
                </h3>
                <p className="text-[var(--on-surface-variant)] leading-relaxed">
                  No. DebtSync is an informational ledger, record-keeping, and interest calculation platform. You settle funds directly with your counterparty via UPI, cash, or bank transfer, and record verified receipts on DebtSync to keep mutual records accurate.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-2">
                <h3 className="font-heading text-sm font-bold text-[var(--on-surface)]">
                  How does the interest calculation work?
                </h3>
                <p className="text-[var(--on-surface-variant)] leading-relaxed">
                  You can specify 0% interest, Simple Interest, or Compounding Interest (Daily, Weekly, Monthly, or Yearly compounding). DebtSync calculates accrued interest continuously down to the second, updating live on both parties&apos; dashboards.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-2">
                <h3 className="font-heading text-sm font-bold text-[var(--on-surface)]">
                  How is the Network Trust Score (300–850) calculated?
                </h3>
                <p className="text-[var(--on-surface-variant)] leading-relaxed">
                  Your Network Trust Score is dynamically computed on the server across 4 calibrated pillars: Repayment Punctuality (38%), Principal Clearance &amp; Capital Velocity (27%), Verified Peer Network Breadth (15%), and Dispute-Free Consensus (20%). Because it is server-calibrated using UTC calendar dates, every counterparty and device sees the exact same score without exposing private individual debt amounts.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-2">
                <h3 className="font-heading text-sm font-bold text-[var(--on-surface)]">
                  How does the public share link keep my data safe?
                </h3>
                <p className="text-[var(--on-surface-variant)] leading-relaxed">
                  Public links use rotated cryptographic tokens. They are read-only, sensitive email addresses are strictly masked (e.g. <span className="text-[var(--primary)]">s***k@domain.com</span>), and creator/counterparty private notes are completely stripped. Either participant can revoke the public link at any time.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-2">
                <h3 className="font-heading text-sm font-bold text-[var(--on-surface)]">
                  Can I install DebtSync as an app on my phone?
                </h3>
                <p className="text-[var(--on-surface-variant)] leading-relaxed">
                  Yes! DebtSync is a full Progressive Web App (PWA). On iOS, tap &quot;Share&quot; → &quot;Add to Home Screen&quot;. On Android, tap the install banner or browser menu → &quot;Install App&quot;. You get an app icon, standalone fullscreen view, and push notifications.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--outline-variant)]/30 space-y-2">
                <h3 className="font-heading text-sm font-bold text-[var(--on-surface)]">
                  How can I request account or data deletion?
                </h3>
                <p className="text-[var(--on-surface-variant)] leading-relaxed">
                  We respect user privacy under the Digital Personal Data Protection (DPDP) Act. You can purge agreements directly or email <a href="mailto:support@satya-nayak.dev" className="text-[var(--primary)] underline">support@satya-nayak.dev</a> to request complete account deletion within 48 hours.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA Banner */}
        <section className="py-20 text-center relative overflow-hidden">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
            <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-extrabold text-[var(--on-surface)] tracking-tight">
              Ready to sync your peer ledgers?
            </h2>
            <p className="font-mono text-xs sm:text-sm text-[var(--on-surface-variant)] max-w-xl mx-auto leading-relaxed">
              Join DebtSync for free. Zero ads, zero tracking, and transparent mutual financial consensus.
            </p>
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              {isLoggedIn ? (
                <Link
                  href="/dash"
                  onClick={clearPublicSession}
                  className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-sm font-bold hover:opacity-90 active:scale-95 transition-all shadow-md min-h-[48px] flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">dashboard</span>
                  <span>Return to Your Dashboard</span>
                </Link>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-sm font-bold hover:opacity-90 active:scale-95 transition-all shadow-md min-h-[48px] flex items-center justify-center gap-2"
                  >
                    <span>Get Started Free</span>
                    <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
                  </Link>
                  <Link
                    href="/login"
                    className="w-full sm:w-auto px-6 py-3.5 rounded-xl border border-[var(--outline-variant)]/40 hover:bg-[var(--surface-container)] font-mono text-sm font-semibold text-[var(--on-surface)] min-h-[48px] flex items-center justify-center"
                  >
                    Sign In
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface)] flex items-center justify-center font-mono text-xs text-[var(--on-surface-variant)]">Loading DebtSync...</div>}>
      <LandingPageContent />
    </Suspense>
  );
}
