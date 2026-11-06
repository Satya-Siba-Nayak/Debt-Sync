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
  const [isQuickMenuOpen, setIsQuickMenuOpen] = React.useState(false);

  React.useEffect(() => {
    setIsQuickMenuOpen(false);
  }, [pathname]);

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
    if (href === '/dash') return pathname === '/dash';
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
        { label: 'Home', href: '/dash', icon: 'space_dashboard' },
        { label: 'People', href: '/directory', icon: 'group' },
      ];

  const rightItems = inAdminMode
    ? [
        { label: 'Ledgers', href: '/admin?tab=transactions', icon: 'receipt_long' },
        { label: 'Analytics', href: '/admin?tab=analytics', icon: 'monitoring' },
      ]
    : [
        { label: 'Transactions', href: '/transactions', icon: 'receipt_long' },
        { label: 'Analytics', href: '/analytics', icon: 'monitoring' },
      ];

  const renderItem = (item: { label: string; href: string; icon: string }) => {
    const isActive = checkIsActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => {
          setIsQuickMenuOpen(false);
          handleNavClick(item.href);
        }}
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
    'w-14 h-14 rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-container)] text-[var(--on-primary)] shadow-lg shadow-[var(--primary)]/30 flex items-center justify-center ring-4 ring-[var(--surface-container-lowest)] active:scale-90 transition-all cursor-pointer';

  return (
    <>
      {/* Mobile Quick Create Backdrop & Floating Menu */}
      {isQuickMenuOpen && !inAdminMode && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-150"
          onClick={() => setIsQuickMenuOpen(false)}
        >
          <div
            className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 w-[min(21.5rem,calc(100vw-2rem))] bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/40 rounded-2xl p-3 shadow-2xl space-y-2 animate-in slide-in-from-bottom-4 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-1 pb-1.5 border-b border-[var(--outline-variant)]/20">
              <span className="font-mono text-[10px] uppercase tracking-wider font-bold text-[var(--on-surface-variant)]">
                What would you like to do?
              </span>
              <button
                type="button"
                onClick={() => setIsQuickMenuOpen(false)}
                className="text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] p-0.5 rounded-lg"
                aria-label="Close quick actions"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsQuickMenuOpen(false);
                onNewTransaction?.();
              }}
              className="w-full p-3 rounded-xl bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 border border-[var(--primary)]/30 flex items-center gap-3 text-left transition-colors active:scale-[0.99] cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] flex items-center justify-center shrink-0 shadow-xs">
                <span className="material-symbols-outlined text-[20px]">add_card</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-heading text-sm font-bold text-[var(--on-surface)]">
                  Record Debt or Loan
                </div>
                <div className="font-mono text-[11px] text-[var(--on-surface-variant)] truncate">
                  Log money you lent or borrowed (1-on-1)
                </div>
              </div>
              <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">
                chevron_right
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsQuickMenuOpen(false);
                window.dispatchEvent(new CustomEvent('debtsync:open_split_modal'));
              }}
              className="w-full p-3 rounded-xl bg-[var(--surface-container-low)] hover:bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/30 flex items-center gap-3 text-left transition-colors active:scale-[0.99] cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/15 text-[var(--primary)] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">call_split</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-heading text-sm font-bold text-[var(--on-surface)]">
                  Split a Group Bill
                </div>
                <div className="font-mono text-[11px] text-[var(--on-surface-variant)] truncate">
                  Divide dinner, rent, or trip expenses
                </div>
              </div>
              <span className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">
                chevron_right
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsQuickMenuOpen(false);
                window.dispatchEvent(new CustomEvent('debtsync:open_add_person'));
              }}
              className="w-full p-3 rounded-xl bg-[var(--surface-container-low)] hover:bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/30 flex items-center gap-3 text-left transition-colors active:scale-[0.99] cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-[var(--secondary)]/15 text-[var(--secondary)] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">person_add</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-heading text-sm font-bold text-[var(--on-surface)]">
                  Add New Person
                </div>
                <div className="font-mono text-[11px] text-[var(--on-surface-variant)] truncate">
                  Add a friend or contact to your directory
                </div>
              </div>
              <span className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">
                chevron_right
              </span>
            </button>
          </div>
        </div>
      )}

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--surface-container-lowest)]/95 backdrop-blur-lg border-t border-[var(--outline-variant)]/30 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom,0px)] pl-[max(0.25rem,env(safe-area-inset-left,0px))] pr-[max(0.25rem,env(safe-area-inset-right,0px))]"
        aria-label="Primary"
      >
        <div className="h-16 px-1 flex items-center">
          <div className="flex items-center flex-1">{leftItems.map(renderItem)}</div>

          {/* Center Floating Action Button (+ Quick Actions or Admin Shield) */}
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
                onClick={() => setIsQuickMenuOpen((prev) => !prev)}
                className={fabClass}
                title="Create: Record Debt, Split Bill, or Add Person"
                aria-label="Open quick create menu"
                aria-expanded={isQuickMenuOpen}
              >
                <span
                  className={`material-symbols-outlined text-[28px] transition-transform duration-200 ${
                    isQuickMenuOpen ? 'rotate-45' : ''
                  }`}
                >
                  add
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center flex-1">{rightItems.map(renderItem)}</div>
        </div>
      </nav>
    </>
  );
}
