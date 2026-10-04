'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useViewMode } from '@/lib/hooks/useViewMode';

interface BottomNavProps {
  onNewTransaction?: () => void;
  isAdmin?: boolean;
}

export function BottomNav({ onNewTransaction, isAdmin }: BottomNavProps) {
  const pathname = usePathname();
  const { inAdminMode } = useViewMode(isAdmin);
  const [adminTab, setAdminTab] = React.useState<string>('overview');

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get('tab') || 'overview';
    setAdminTab(initialTab === 'live' ? 'overview' : initialTab);

    const handleTabChange = (e: any) => {
      if (e.detail?.tab) {
        const t = e.detail.tab;
        setAdminTab(t === 'live' ? 'overview' : t);
      }
    };
    window.addEventListener('debtsync:admin_tab_changed', handleTabChange);
    return () => window.removeEventListener('debtsync:admin_tab_changed', handleTabChange);
  }, [pathname]);

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
    return pathname === href || pathname.startsWith(href + '/');
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
        { label: 'Live', href: '/admin?tab=overview', icon: 'sensors' },
        { label: 'Users', href: '/admin?tab=users', icon: 'manage_accounts' },
      ]
    : [
        { label: 'Home', href: '/', icon: 'dashboard' },
        { label: 'People', href: '/directory', icon: 'group' },
      ];

  const rightItems = inAdminMode
    ? [
        { label: 'Ledgers', href: '/admin?tab=transactions', icon: 'receipt_long' },
        { label: 'Settings', href: '/settings', icon: 'settings' },
      ]
    : [
        { label: 'Ledgers', href: '/transactions', icon: 'receipt_long' },
        { label: 'Analytics', href: '/analytics', icon: 'monitoring' },
      ];

  const renderItem = (item: { label: string; href: string; icon: string }) => {
    const isActive = checkIsActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => handleNavClick(item.href)}
        aria-current={isActive ? 'page' : undefined}
        className={`relative flex flex-col items-center justify-center flex-1 min-w-[56px] h-14 rounded-xl transition-colors active:scale-95 ${
          isActive
            ? 'text-[var(--primary)] dark:text-[var(--primary-fixed-dim)]'
            : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
        }`}
      >
        <span
          className={`flex items-center justify-center w-12 h-7 rounded-full transition-colors ${
            isActive ? 'bg-[var(--primary)]/12 dark:bg-[var(--primary-fixed-dim)]/15' : ''
          }`}
        >
          <span
            className="material-symbols-outlined text-[22px]"
            style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
          >
            {item.icon}
          </span>
        </span>
        <span className={`font-mono text-[10px] tracking-tight mt-0.5 ${isActive ? 'font-bold' : 'font-medium'}`}>
          {item.label}
        </span>
      </Link>
    );
  };

  const fabClass =
    'w-14 h-14 rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-container)] text-[var(--on-primary)] shadow-lg shadow-[var(--primary)]/30 flex items-center justify-center ring-4 ring-[var(--surface-container-lowest)] active:scale-90 transition-transform cursor-pointer';

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--surface-container-lowest)]/95 backdrop-blur-lg border-t border-[var(--outline-variant)]/30 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom,0px)] pl-[max(0.25rem,env(safe-area-inset-left,0px))] pr-[max(0.25rem,env(safe-area-inset-right,0px))]"
      aria-label="Primary"
    >
      <div className="h-16 px-1 flex items-center">
        <div className="flex items-center flex-1">{leftItems.map(renderItem)}</div>

        {/* Center Floating Action Button (+ Record or Admin Shield) */}
        <div className="relative -top-4 px-1.5 shrink-0">
          {inAdminMode ? (
            <Link
              href="/admin"
              onClick={() => handleNavClick('/admin')}
              className={fabClass}
              title="Admin Observatory"
              aria-label="Admin Observatory"
            >
              <span className="material-symbols-outlined text-[26px]">shield_person</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={onNewTransaction}
              className={fabClass}
              title="Record New Debt"
              aria-label="Record new debt"
            >
              <span className="material-symbols-outlined text-[28px]">add</span>
            </button>
          )}
        </div>

        <div className="flex items-center flex-1">{rightItems.map(renderItem)}</div>
      </div>
    </nav>
  );
}
