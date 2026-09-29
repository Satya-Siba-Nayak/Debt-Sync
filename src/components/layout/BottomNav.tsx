'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface BottomNavProps {
  onNewTransaction?: () => void;
  isAdmin?: boolean;
}

export function BottomNav({ onNewTransaction, isAdmin }: BottomNavProps) {
  const pathname = usePathname();
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

  const inAdminMode = Boolean(isAdmin && viewMode === 'admin');

  const leftItems = inAdminMode
    ? [
        { label: 'Admin Hub', href: '/admin', icon: 'admin_panel_settings' },
        { label: 'Live Stream', href: '/admin?tab=live', icon: 'sensors' },
      ]
    : [
        { label: 'Dashboard', href: '/', icon: 'dashboard' },
        { label: 'Directory', href: '/directory', icon: 'group' },
      ];

  const rightItems = inAdminMode
    ? [
        { label: 'Users', href: '/admin?tab=users', icon: 'manage_accounts' },
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
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : item.href.startsWith('/admin')
              ? pathname === '/admin'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
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
          const isActive =
            item.href.startsWith('/admin')
              ? pathname === '/admin'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
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
