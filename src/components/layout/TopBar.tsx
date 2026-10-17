'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Avatar, AVATAR_PRESETS } from '../ui/Avatar';
import { BrandLogo } from '../ui/BrandLogo';
import { NotificationCenter } from './NotificationCenter';
import { createClient } from '@/lib/supabase/client';
import { clearAuthSessionData } from '@/lib/utils/auth-session';
import { unsubscribeFromPush } from '@/lib/utils/push-notifications';
import { useViewMode } from '@/lib/hooks/useViewMode';

interface TopBarProps {
  title?: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  avatarUrl?: string | null;
  recentCustomAvatars?: string[];
  isAdmin?: boolean;
  onNewTransaction?: () => void;
}

export function TopBar({
  title,
  userId,
  userName,
  userEmail,
  avatarUrl,
  recentCustomAvatars = [],
  isAdmin,
  onNewTransaction,
}: TopBarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const {
    isAdmin: effectiveIsAdmin,
    viewMode,
    inAdminMode,
    toggleViewMode: handleToggleMode,
  } = useViewMode(isAdmin);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerMobileRef = useRef<HTMLButtonElement>(null);
  const triggerDesktopRef = useRef<HTMLButtonElement>(null);
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();

  const resolvedHeader = React.useMemo(() => {
    if (title) return { heading: title, subtitle: 'Bilateral P2P Financial Ledger', icon: 'dashboard' };
    if (pathname?.startsWith('/admin')) {
      return { heading: 'Admin Observatory', subtitle: 'Platform telemetry, user governance & live ledgers', icon: 'shield_person' };
    }
    if (pathname?.startsWith('/directory/detail')) {
      return { heading: 'Counterparty Ledger', subtitle: 'Bilateral agreement history & direct settlement', icon: 'menu_book' };
    }
    if (pathname?.startsWith('/directory')) {
      return { heading: 'People Directory', subtitle: 'Counterparties, trust scores & net positions', icon: 'group' };
    }
    if (pathname?.startsWith('/transactions')) {
      return { heading: 'Transactions Ledger', subtitle: 'Audit trail of peer-to-peer agreements & repayments', icon: 'receipt_long' };
    }
    if (pathname?.startsWith('/analytics')) {
      return { heading: 'Analytics & Performance', subtitle: 'Portfolio yield, repayment velocity & maturity profile', icon: 'monitoring' };
    }
    if (pathname?.startsWith('/settings')) {
      return { heading: 'Account & Preferences', subtitle: 'Profile identity, UPI settlement & alert controls', icon: 'tune' };
    }
    return { heading: 'Global Dashboard', subtitle: 'Real-time bilateral portfolio & active obligations', icon: 'space_dashboard' };
  }, [title, pathname]);

  // Close dropdown on outside click or escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        !triggerMobileRef.current?.contains(target) &&
        !triggerDesktopRef.current?.contains(target)
      ) {
        setIsDropdownOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDropdownOpen]);

  const handleSelectAvatar = async (selectedUrl: string) => {
    if (!userId) return;
    try {
      await supabase
        .from('profiles')
        .update({ avatar_url: selectedUrl })
        .eq('id', userId);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('debtsync:user_updated', {
            detail: { avatarUrl: selectedUrl },
          })
        );
      }
    } catch (err) {
      console.error('Failed to switch avatar from dropdown:', err);
    }
  };

  const handleSignOut = async () => {
    setIsDropdownOpen(false);
    await unsubscribeFromPush().catch(() => {});
    clearAuthSessionData();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <>
      {/* Mobile Header (True Edge-to-Edge with Safe Areas) */}
      <header className="bg-[var(--surface)]/95 w-full sticky top-0 z-30 md:hidden border-b border-[var(--outline-variant)]/30 backdrop-blur-md pt-[env(safe-area-inset-top,0px)] pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] transition-colors">
        <div className="flex justify-between items-center w-full h-14 min-w-0">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <BrandLogo size="sm" showTagline={false} href="/" />
            {inAdminMode && (
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold bg-[var(--primary)]/15 text-[var(--primary)] shrink-0">
                ADMIN
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <NotificationCenter />
            <ThemeToggle compact />
            <button
              ref={triggerMobileRef}
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40 active:scale-95 transition-transform"
              title="Profile menu"
              aria-label="Open profile menu"
              aria-expanded={isDropdownOpen}
            >
              <Avatar src={avatarUrl} name={userName || userEmail} size="sm" className="rounded-full ring-2 ring-[var(--outline-variant)]/30" />
            </button>
          </div>
        </div>
      </header>

      {/* Desktop Header */}
      <div className="hidden md:flex justify-between items-center px-8 py-3.5 sticky top-0 bg-[var(--surface)]/90 backdrop-blur-md z-30 border-b border-[var(--outline-variant)]/20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[var(--surface-container-high)] text-[var(--primary)] flex items-center justify-center shrink-0 border border-[var(--outline-variant)]/20">
            <span className="material-symbols-outlined text-[19px]">
              {resolvedHeader.icon}
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="font-heading text-xl font-bold text-[var(--on-surface)] truncate leading-tight">
              {resolvedHeader.heading}
            </h1>
            <p className="font-mono text-[11px] text-[var(--on-surface-variant)] truncate">
              {resolvedHeader.subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {!inAdminMode && (
            <div className="flex items-center gap-2 mr-1">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('debtsync:open_split_modal'))}
                className="px-3 py-1.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container-low)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] font-mono text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Split a bill among multiple people"
              >
                <span className="material-symbols-outlined text-[15px] text-[var(--primary)]">call_split</span>
                <span>Split Bill</span>
              </button>
              {onNewTransaction && (
                <button
                  type="button"
                  onClick={onNewTransaction}
                  className="px-3.5 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-xs flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px]">add</span>
                  <span>New Entry</span>
                </button>
              )}
            </div>
          )}

          <NotificationCenter />

          <button
            ref={triggerDesktopRef}
            type="button"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-2.5 pl-2 border-l border-[var(--outline-variant)]/20 group cursor-pointer focus:outline-none"
            title="Profile & Avatar menu"
          >
            <Avatar
              src={avatarUrl}
              name={userName || userEmail}
              size="sm"
              className="rounded-full group-hover:ring-2 ring-[var(--primary)]/30 transition-all shadow-sm"
            />
            {userName && (
              <span className="font-mono text-xs font-semibold text-[var(--on-surface)] group-hover:text-[var(--primary)] transition-colors max-w-[140px] truncate">
                {userName}
              </span>
            )}
            <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)] transition-transform duration-150">
              {isDropdownOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
            </span>
          </button>
        </div>
      </div>

      {/* Profile & Avatar Quick Dropdown Menu */}
      {isDropdownOpen && (
        <div
          ref={dropdownRef}
          className="fixed right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[calc(3.5rem+env(safe-area-inset-top,0px)+0.5rem)] md:right-8 md:top-16 w-[min(18rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain bg-[var(--surface-container-lowest)] rounded-2xl p-3.5 border border-[var(--outline-variant)]/30 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 space-y-3"
          role="menu"
        >
          {/* User Details */}
          <div className="flex items-center gap-3 pb-2.5 border-b border-[var(--outline-variant)]/20">
            <Avatar src={avatarUrl} name={userName || userEmail} size="md" />
            <div className="min-w-0 flex-1">
              <p className="font-heading text-sm font-bold text-[var(--on-surface)] truncate">
                {userName || 'User'}
              </p>
              <p className="font-mono text-[11px] text-[var(--on-surface-variant)] truncate">
                {userEmail}
              </p>
            </div>
          </div>

          {/* Quick Avatar Switcher */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-[var(--outline)] uppercase tracking-wider font-semibold">
                Switch Avatar
              </span>
              <Link
                href="/settings"
                onClick={() => setIsDropdownOpen(false)}
                className="text-[10px] font-mono text-[var(--primary)] hover:underline flex items-center gap-0.5"
              >
                <span>Edit &amp; More</span>
                <span className="material-symbols-outlined text-[12px]">chevron_right</span>
              </Link>
            </div>

            {/* Recent Custom Photos (Max 2) */}
            {recentCustomAvatars && recentCustomAvatars.length > 0 && (
              <div>
                <span className="font-mono text-[10px] text-[var(--on-surface-variant)] block mb-1">
                  Your recent custom photos:
                </span>
                <div className="flex items-center gap-2">
                  {recentCustomAvatars.map((url, idx) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => handleSelectAvatar(url)}
                      className={`relative w-8 h-8 rounded-xl overflow-hidden border-2 transition-transform hover:scale-105 shrink-0 cursor-pointer shadow-2xs ${
                        avatarUrl === url
                          ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/30 scale-105'
                          : 'border-transparent opacity-80 hover:opacity-100'
                      }`}
                      title={`Custom Photo ${idx + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Custom ${idx + 1}`} className="w-full h-full object-cover pointer-events-none" />
                      {avatarUrl === url && (
                        <div className="absolute inset-0 bg-[var(--primary)]/25 flex items-center justify-center">
                          <span className="material-symbols-outlined text-[13px] text-white font-bold drop-shadow">check</span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Featured Presets */}
            <div>
              <span className="font-mono text-[10px] text-[var(--on-surface-variant)] block mb-1">
                Presets:
              </span>
              <div className="flex items-center gap-2">
                {AVATAR_PRESETS.slice(0, 5).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectAvatar(preset.url)}
                    className={`relative w-8 h-8 rounded-xl overflow-hidden border-2 transition-transform hover:scale-105 shrink-0 cursor-pointer shadow-2xs ${
                      avatarUrl === preset.url
                        ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/30 scale-105'
                        : 'border-transparent opacity-80 hover:opacity-100'
                    }`}
                    title={preset.label}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={preset.url} alt={preset.label} className="w-full h-full object-cover pointer-events-none" />
                    {avatarUrl === preset.url && (
                      <div className="absolute inset-0 bg-[var(--primary)]/25 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[13px] text-white font-bold drop-shadow">check</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Menu Actions */}
          <div className="pt-2 border-t border-[var(--outline-variant)]/20 space-y-1">
            {effectiveIsAdmin && (
              <div className="p-2 mb-1 rounded-xl bg-[var(--surface-container)]/60 border border-[var(--outline-variant)]/20 space-y-2">
                <div className="flex items-center justify-between px-0.5">
                  <span className="font-mono text-[10px] text-[var(--outline)] uppercase tracking-wider font-semibold">
                    View Mode
                  </span>
                  <Link
                    href="/admin"
                    onClick={() => setIsDropdownOpen(false)}
                    className="text-[10px] font-mono font-bold text-[var(--primary)] hover:underline flex items-center gap-0.5"
                  >
                    <span className="material-symbols-outlined text-[13px]">shield_person</span>
                    <span>Observatory</span>
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-[var(--surface-container-high)]/60" role="radiogroup" aria-label="View mode">
                  {(['user', 'admin'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={viewMode === mode}
                      onClick={() => {
                        if (viewMode !== mode) handleToggleMode();
                        setIsDropdownOpen(false);
                      }}
                      className={`min-h-[36px] rounded-md font-mono text-[11px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        viewMode === mode
                          ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-sm'
                          : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {mode === 'admin' ? 'admin_panel_settings' : 'person'}
                      </span>
                      <span>{mode === 'admin' ? 'Admin' : 'User'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Link
              href="/settings"
              onClick={() => setIsDropdownOpen(false)}
              className="w-full flex items-center gap-2.5 px-2.5 min-h-[44px] md:min-h-[36px] rounded-xl font-mono text-xs text-[var(--on-surface)] hover:bg-[var(--surface-container)] transition-colors"
              role="menuitem"
            >
              <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">manage_accounts</span>
              <span>Profile &amp; Preferences</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setIsDropdownOpen(false);
                window.dispatchEvent(new CustomEvent('debtsync:open_bug_report'));
              }}
              className="w-full flex items-center gap-2.5 px-2.5 min-h-[44px] md:min-h-[36px] rounded-xl font-mono text-xs text-[var(--on-surface)] hover:bg-[var(--surface-container)] transition-colors cursor-pointer text-left"
              role="menuitem"
            >
              <span className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">warning</span>
              <span>Report Issue / Feedback</span>
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center gap-2.5 px-2.5 min-h-[44px] md:min-h-[36px] rounded-xl font-mono text-xs text-[var(--error)] hover:bg-red-500/10 transition-colors cursor-pointer text-left"
              role="menuitem"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

