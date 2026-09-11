'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ThemeToggle } from '../ui/ThemeToggle';

interface SidebarProps {
  onNewTransaction?: () => void;
}

export function Sidebar({ onNewTransaction }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const navItems = [
    { label: 'Dashboard', href: '/', icon: 'dashboard' },
    { label: 'Directory', href: '/directory', icon: 'group' },
    { label: 'Transactions', href: '/transactions', icon: 'receipt_long' },
    { label: 'Analytics', href: '/analytics', icon: 'analytics' },
    { label: 'Settings', href: '/settings', icon: 'settings' },
  ];

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
            Trust & Precision
          </div>
        </div>
      </div>

      {/* New Transaction Button */}
      {onNewTransaction ? (
        <button
          onClick={onNewTransaction}
          className="bg-[var(--primary)] text-[var(--on-primary)] font-medium py-3 px-4 rounded-xl mb-6 w-full flex justify-center items-center gap-2 hover:opacity-95 active:scale-[0.98] transition-all shadow-sm"
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
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-mono text-sm transition-all ${
                isActive
                  ? 'bg-[var(--surface-container-high)] text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] font-bold shadow-sm'
                  : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]/60 hover:text-[var(--on-surface)]'
              }`}
            >
              <span
                className="material-symbols-outlined text-[20px]"
                style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom Footer Area */}
      <div className="mt-auto flex flex-col gap-2 border-t border-[var(--outline-variant)]/20 pt-4">
        <div className="flex items-center justify-between px-1 mb-1">
          <span className="font-mono text-xs text-[var(--on-surface-variant)]">Theme</span>
          <ThemeToggle />
        </div>

        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-xl font-mono text-xs text-[var(--on-surface-variant)] hover:bg-red-500/10 hover:text-[var(--error)] transition-colors text-left w-full"
        >
          <span className="material-symbols-outlined text-[18px]">logout</span>
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
