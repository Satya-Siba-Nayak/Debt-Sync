'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getCachedUserProfile } from '@/lib/utils/auth-session';

interface BottomNavProps {
  onNewTransaction?: () => void;
  isAdmin?: boolean;
}

export function BottomNav({ onNewTransaction, isAdmin }: BottomNavProps) {
  const pathname = usePathname();
  const [viewMode, setViewMode] = React.useState<'admin' | 'user'>('admin');
  const [adminTab, setAdminTab] = React.useState<string>('overview');
  const [isAdminState, setIsAdminState] = React.useState<boolean>(() => {
    if (isAdmin !== undefined) return Boolean(isAdmin);
    if (typeof window !== 'undefined') {
      const cached = getCachedUserProfile();
      if (cached?.is_admin) return true;
    }
    return false;
  });

  React.useEffect(() => {
    if (isAdmin !== undefined) {
      setIsAdminState(Boolean(isAdmin));
    } else if (typeof window !== 'undefined') {
      const cached = getCachedUserProfile();
      if (cached?.is_admin) setIsAdminState(true);
    }
  }, [isAdmin]);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('debtsync_view_mode') as 'admin' | 'user' | null;
      if (saved) setViewMode(saved);

      const params = new URLSearchParams(window.location.search);
      const initialTab = params.get('tab') || 'overview';
      setAdminTab(initialTab === 'live' ? 'overview' : initialTab);

      const handleModeChange = (e: any) => {
        if (e.detail?.mode) setViewMode(e.detail.mode);
      };
      const handleTabChange = (e: any) => {
        if (e.detail?.tab) {
          const t = e.detail.tab;
          setAdminTab(t === 'live' ? 'overview' : t);
        }
      };
      const handleUserUpdated = (e: any) => {
        if (e.detail?.isAdmin !== undefined) {
          setIsAdminState(Boolean(e.detail.isAdmin));
        }
      };

      window.addEventListener('debtsync:view_mode_changed', handleModeChange);
      window.addEventListener('debtsync:admin_tab_changed', handleTabChange);
      window.addEventListener('debtsync:user_updated', handleUserUpdated);
      return () => {
        window.removeEventListener('debtsync:view_mode_changed', handleModeChange);
        window.removeEventListener('debtsync:admin_tab_changed', handleTabChange);
        window.removeEventListener('debtsync:user_updated', handleUserUpdated);
      };
    }
  }, [pathname]);

  const effectiveIsAdmin = Boolean(isAdminState || isAdmin || viewMode === 'admin');
  const inAdminMode = Boolean(effectiveIsAdmin && viewMode === 'admin');

  const checkIsActive = (href: string) => {
    if (inAdminMode) {
      if (href === '/settings') return pathname === '/settings';
      if (pathname !== '/admin') return false;
      const targetTab = href.includes('tab=')
        ? new URLSearchParams(href.split('?')[1]).get('tab')
        : 'overview';
      const effectiveTarget = targetTab === 'live' ? 'overview' : targetTab;
      return adminTab === effectiveTarget;
    }
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const handleNavClick = (href: string) => {
    if (href.includes('tab=')) {
      const t = new URLSearchParams(href.split('?')[1]).get('tab');
      if (t) {
        const resolvedTab = t === 'live' ? 'overview' : t;
        setAdminTab(resolvedTab);
        window.dispatchEvent(new CustomEvent('debtsync:admin_tab_changed', { detail: { tab: resolvedTab } }));
      }
    } else if (href === '/admin') {
      setAdminTab('overview');
      window.dispatchEvent(new CustomEvent('debtsync:admin_tab_changed', { detail: { tab: 'overview' } }));
    }
  };

  const leftItems = inAdminMode
    ? [
        { label: 'Live View', href: '/admin?tab=overview', icon: 'sensors' },
        { label: 'Users', href: '/admin?tab=users', icon: 'manage_accounts' },
      ]
    : [
        { label: 'Dashboard', href: '/', icon: 'dashboard' },
        { label: 'Directory', href: '/directory', icon: 'group' },
      ];

  const rightItems = inAdminMode
    ? [
        { label: 'Ledgers', href: '/admin?tab=transactions', icon: 'receipt_long' },
        { label: 'Settings', href: '/settings', icon: 'settings' },
      ]
    : [
        { label: 'Ledgers', href: '/transactions', icon: 'receipt_long' },
        { label: 'Settings', href: '/settings', icon: 'settings' },
      ];

  return (
    <nav className="md:hidden bg-[var(--surface-container-lowest)]/95 backdrop-blur-lg fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--outline-variant)]/30 px-3 h-16 flex items-center justify-between shadow-lg pb-[env(safe-area-inset-bottom,0px)]">
      {/* Left Navigation Group */}
      <div className="flex items-center justify-around flex-1">
        {leftItems.map((item) => {
          const isActive = checkIsActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => handleNavClick(item.href)}
              className={`flex flex-col items-center justify-center py-1 transition-all active:scale-95 ${
                isActive
                  ? 'text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] font-bold'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              <span
                className="material-symbols-outlined text-[22px]"
                style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {item.icon}
              </span>
              <span className="font-mono text-[10px] tracking-tight mt-0.5">{item.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Center Floating Action Button (+ Record or Admin Shield) */}
      <div className="relative -top-3 px-2">
        {inAdminMode ? (
          <Link
            href="/admin"
            onClick={() => handleNavClick('/admin')}
            className="w-13 h-13 rounded-2xl bg-[var(--primary)] text-[var(--on-primary)] shadow-lg hover:shadow-xl shadow-[var(--primary)]/25 flex flex-col items-center justify-center border-4 border-[var(--surface-container-lowest)] active:scale-90 transition-all cursor-pointer"
            title="Admin Observatory"
          >
            <span className="material-symbols-outlined text-[24px]">shield_person</span>
          </Link>
        ) : (
          <button
            onClick={onNewTransaction}
            className="w-13 h-13 rounded-2xl bg-[var(--primary)] text-[var(--on-primary)] shadow-lg hover:shadow-xl shadow-[var(--primary)]/25 flex flex-col items-center justify-center border-4 border-[var(--surface-container-lowest)] active:scale-90 transition-all cursor-pointer"
            title="Record New Debt"
          >
            <span className="material-symbols-outlined text-[24px]">add</span>
          </button>
        )}
      </div>

      {/* Right Navigation Group */}
      <div className="flex items-center justify-around flex-1">
        {rightItems.map((item) => {
          const isActive = checkIsActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => handleNavClick(item.href)}
              className={`flex flex-col items-center justify-center py-1 transition-all active:scale-95 ${
                isActive
                  ? 'text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] font-bold'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              <span
                className="material-symbols-outlined text-[22px]"
                style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {item.icon}
              </span>
              <span className="font-mono text-[10px] tracking-tight mt-0.5">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
