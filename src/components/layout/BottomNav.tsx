'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface BottomNavProps {
  onNewTransaction?: () => void;
}

export function BottomNav({ onNewTransaction }: BottomNavProps) {
  const pathname = usePathname();

  const items = [
    { label: 'Dashboard', href: '/', icon: 'dashboard' },
    { label: 'Directory', href: '/directory', icon: 'group' },
    { label: 'Transact', href: '/transactions', icon: 'receipt_long' },
    { label: 'Analytics', href: '/analytics', icon: 'analytics' },
  ];

  return (
    <nav className="md:hidden bg-[var(--surface)] docked full-width bottom-0 flex justify-around items-center w-full h-16 fixed bottom-0 z-40 border-t border-[var(--outline-variant)]/30 backdrop-blur-md">
      {items.map((item) => {
        const isActive =
          item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-transform active:scale-95 ${
              isActive
                ? 'text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] font-bold border-t-2 border-[var(--primary)] dark:border-[var(--primary-fixed-dim)]'
                : 'text-[var(--on-surface-variant)] hover:text-[var(--primary)]'
            }`}
          >
            <span
              className="material-symbols-outlined text-[22px]"
              style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {item.icon}
            </span>
            <span className="font-mono text-[10px] mt-0.5">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
