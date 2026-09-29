'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ThemeToggle } from '../ui/ThemeToggle';

import { clearAuthSessionData } from '@/lib/utils/auth-session';

interface SidebarProps {
  onNewTransaction?: () => void;
  isAdmin?: boolean;
}

export function Sidebar({ onNewTransaction, isAdmin }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [viewMode, setViewMode] = React.useState<'admin' | 'user'>('admin');

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('debtsync_view_mode') as 'admin' | 'user' | null;
      if (saved) setViewMode(saved);

      const handleModeChange = (e: any) => {
        if (e.detail?.mode) {
          setViewMode(e.detail.mode);
        }
      };
      window.addEventListener('debtsync:view_mode_changed', handleModeChange);
      return () => window.removeEventListener('debtsync:view_mode_changed', handleModeChange);
    }
  }, []);

  const handleToggleMode = () => {
    const nextMode = viewMode === 'admin' ? 'user' : 'admin';
    setViewMode(nextMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('debtsync_view_mode', nextMode);
      window.dispatchEvent(new CustomEvent('debtsync:view_mode_changed', { detail: { mode: nextMode } }));
    }
  };

  const handleSignOut = async () => {
    clearAuthSessionData();
    await supabase.auth.signOut();
    router.push('/login');
  };

  const inAdminMode = Boolean(isAdmin && viewMode === 'admin');

  interface NavItem {
    label: string;
    href: string;
    icon: string;
    badge?: string;
  }

  const adminNavItems: NavItem[] = [
    { label: 'Admin Hub', href: '/admin', icon: 'admin_panel_settings', badge: 'ROOT' },
    { label: 'Settings', href: '/settings', icon: 'settings' },
  ];

  const userNavItems: NavItem[] = [
    { label: 'Dashboard', href: '/', icon: 'dashboard' },
    { label: 'Directory', href: '/directory', icon: 'group' },
    { label: 'Transactions', href: '/transactions', icon: 'receipt_long' },
    { label: 'Analytics', href: '/analytics', icon: 'analytics' },
    { label: 'Settings', href: '/settings', icon: 'settings' },
  ];

  const navItems: NavItem[] = inAdminMode ? adminNavItems : userNavItems;

  return (
    <aside className="hidden md:flex bg-[var(--surface-container)] docked left-0 h-screen w-60 fixed left-0 top-0 flex-col p-4 border-r border-[var(--outline-variant)]/30 z-40 transition-colors">
      {/* Brand Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-container)] flex items-center justify-center text-[var(--on-primary)] font-bold text-xl shadow-md">
          D
        </div>
        <div>
          <div className="font-heading text-lg font-bold text-[var(--primary)] dark:text-[var(--primary-fixed-dim)]">
            DebtSync
          </div>
          <div className="font-mono text-[11px] text-[var(--on-surface-variant)] tracking-wider uppercase">
            {inAdminMode ? 'Admin Console' : 'Trust & Precision'}
          </div>
        </div>
      </div>

      {/* Transaction Button or Admin Console Pill */}
      {inAdminMode ? (
        <div className="space-y-2 mb-5">
          <div className="p-3 rounded-2xl bg-[var(--primary)]/10 border border-[var(--primary)]/20 flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-xs font-bold text-[var(--primary)]">Admin Active</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-[var(--primary)] text-[var(--on-primary)]">
              SUPERUSER
            </span>
          </div>

          <button
            type="button"
            onClick={handleToggleMode}
            className="w-full py-2 px-3 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container-high)]/60 hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] font-mono text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            title="Switch to Normal User View"
          >
            <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
            <span>Switch to User View</span>
          </button>
        </div>
      ) : onNewTransaction ? (
        <button
          onClick={onNewTransaction}
          className="bg-[var(--primary)] text-[var(--on-primary)] font-medium py-3 px-4 rounded-xl mb-6 w-full flex justify-center items-center gap-2 hover:opacity-95 active:scale-[0.98] transition-all shadow-sm cursor-pointer"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          <span>New Transaction</span>
        </button>
      ) : (
        <Link
          href="/?action=new"
          className="bg-[var(--primary)] text-[var(--on-primary)] font-medium py-3 px-4 rounded-xl mb-6 w-full flex justify-center items-center gap-2 hover:opacity-95 active:scale-[0.98] transition-all shadow-sm text-center"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          <span>New Transaction</span>
        </Link>
      )}

      {/* Main Nav Links */}
      <nav className="flex-1 flex flex-col gap-1.5">
        {navItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href) && !item.href.includes('?'));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-3 py-2.5 rounded-xl font-mono text-sm transition-all ${
                isActive
                  ? 'bg-[var(--surface-container-high)] text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] font-bold shadow-sm'
                  : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]/60 hover:text-[var(--on-surface)]'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="material-symbols-outlined text-[20px]"
                  style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-[var(--primary)]/15 text-[var(--primary)]">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom Footer Area */}
      <div className="mt-auto flex flex-col gap-2 border-t border-[var(--outline-variant)]/20 pt-4">
        {isAdmin && (
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="font-mono text-xs text-[var(--on-surface-variant)]">View Mode</span>
            <button
              type="button"
              onClick={handleToggleMode}
              className="px-2 py-0.5 rounded-lg border border-[var(--outline-variant)]/40 hover:bg-[var(--surface-container-high)] text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center gap-1 text-[var(--primary)]"
              title={viewMode === 'admin' ? 'Currently Admin View. Click to preview normal user view' : 'Currently Normal User View. Click to restore admin view'}
            >
              <span>{viewMode === 'admin' ? '⚡ Admin' : '👤 User'}</span>
              <span className="material-symbols-outlined text-[12px]">swap_horiz</span>
            </button>
          </div>
        )}

        <div className="flex items-center justify-between px-1 mb-1">
          <span className="font-mono text-xs text-[var(--on-surface-variant)]">Theme</span>
          <ThemeToggle />
        </div>

        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-xl font-mono text-xs text-[var(--on-surface-variant)] hover:bg-red-500/10 hover:text-[var(--error)] transition-colors text-left w-full cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">logout</span>
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
