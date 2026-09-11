'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface BottomNavProps {
  onNewTransaction?: () => void;
}

export function BottomNav({ onNewTransaction }: BottomNavProps) {
  const pathname = usePathname();

  const leftItems = [
    { label: 'Dashboard', href: '/', icon: 'dashboard' },
    { label: 'Directory', href: '/directory', icon: 'group' },
  ];

  const rightItems = [
    { label: 'Ledgers', href: '/transactions', icon: 'receipt_long' },
    { label: 'Settings', href: '/settings', icon: 'settings' },
  ];

  return (
    <nav className="md:hidden bg-[var(--surface-container-lowest)]/95 backdrop-blur-lg fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--outline-variant)]/30 px-3 h-16 flex items-center justify-between shadow-lg">
      {/* Left Navigation Group */}
      <div className="flex items-center justify-around flex-1">
        {leftItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
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

      {/* Center Floating Action Button (+ Record) */}
      <div className="relative -top-3 px-2">
        <button
          onClick={onNewTransaction}
          className="w-13 h-13 rounded-2xl bg-[var(--primary)] text-[var(--on-primary)] shadow-lg hover:shadow-xl shadow-[var(--primary)]/25 flex flex-col items-center justify-center border-4 border-[var(--surface-container-lowest)] active:scale-90 transition-all cursor-pointer"
          title="Record New Debt"
        >
          <span className="material-symbols-outlined text-[24px]">add</span>
        </button>
      </div>

      {/* Right Navigation Group */}
      <div className="flex items-center justify-around flex-1">
        {rightItems.map((item) => {
          const isActive = pathname.startsWith(item.href);

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
