'use client';

import React from 'react';
import Link from 'next/link';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Avatar } from '../ui/Avatar';

interface TopBarProps {
  title?: string;
  userName?: string;
  userEmail?: string;
  avatarUrl?: string | null;
  onNewTransaction?: () => void;
}

export function TopBar({ title = 'Global Dashboard', userName, userEmail, avatarUrl, onNewTransaction }: TopBarProps) {
  const initial = (userName || userEmail || 'U').charAt(0).toUpperCase();

  return (
    <>
      {/* Mobile Header */}
      <header className="bg-[var(--surface)] flex justify-between items-center w-full px-4 h-16 sticky top-0 z-30 md:hidden border-b border-[var(--outline-variant)]/30 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] flex items-center justify-center font-bold text-sm">
            D
          </div>
          <span className="font-heading text-lg font-bold text-[var(--primary)] dark:text-[var(--primary-fixed-dim)]">
            DebtSync
          </span>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          {onNewTransaction && (
            <button
              onClick={onNewTransaction}
              className="p-1.5 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] flex items-center justify-center"
              title="New Transaction"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
            </button>
          )}
          <Link href="/settings">
            <Avatar src={avatarUrl} name={userName || userEmail} size="sm" className="rounded-full" />
          </Link>
        </div>
      </header>

      {/* Desktop Header */}
      <div className="hidden md:flex justify-between items-center px-8 py-4 sticky top-0 bg-[var(--surface)]/90 backdrop-blur-md z-30 border-b border-[var(--outline-variant)]/20">
        <div>
          <h1 className="font-heading text-2xl font-bold text-[var(--on-surface)]">
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/settings"
            className="p-2 text-[var(--on-surface-variant)] hover:text-[var(--primary)] rounded-lg hover:bg-[var(--surface-container)] transition-colors"
            title="Settings"
          >
            <span className="material-symbols-outlined text-[22px]">settings</span>
          </Link>

          <Link href="/settings" className="flex items-center gap-2.5 group">
            <Avatar
              src={avatarUrl}
              name={userName || userEmail}
              size="sm"
              className="rounded-full group-hover:ring-2 ring-[var(--primary)]/30 transition-all shadow-sm"
            />
            {userName && (
              <span className="font-mono text-xs font-semibold text-[var(--on-surface)]">
                {userName}
              </span>
            )}
          </Link>
        </div>
      </div>
    </>
  );
}
