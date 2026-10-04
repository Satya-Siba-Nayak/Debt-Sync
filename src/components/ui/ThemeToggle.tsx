'use client';

import { useEffect, useState } from 'react';
import { applyTheme, getStoredTheme, Theme } from '@/lib/utils/theme';

interface ThemeToggleProps {
  compact?: boolean;
}

export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getStoredTheme());
  const [isSystemDark, setIsSystemDark] = useState<boolean>(false);

  useEffect(() => {
    const stored = getStoredTheme();
    setCurrentTheme(stored);
    applyTheme(stored);

    // Initial check for system dark
    if (typeof window !== 'undefined') {
      setIsSystemDark(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    // Listen for theme updates triggered from other ThemeToggle instances or settings
    const handleThemeChange = (e: any) => {
      if (e.detail?.theme) {
        setCurrentTheme(e.detail.theme);
      }
    };
    window.addEventListener('debtsync:theme_change', handleThemeChange);

    // Listen for OS system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsSystemDark(e.matches);
      if (getStoredTheme() === 'system') {
        applyTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handleMediaChange);
    return () => {
      window.removeEventListener('debtsync:theme_change', handleThemeChange);
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  const handleToggle = (theme: Theme) => {
    setCurrentTheme(theme);
    applyTheme(theme);
  };

  const effectiveIsDark = currentTheme === 'dark' || (currentTheme === 'system' && isSystemDark);

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => handleToggle(effectiveIsDark ? 'light' : 'dark')}
        className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container)] transition-colors cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40 active:scale-90"
        title={effectiveIsDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        aria-label="Toggle theme"
      >
        <span className="material-symbols-outlined text-[20px]">
          {effectiveIsDark ? 'light_mode' : 'dark_mode'}
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center bg-[var(--surface-container-high)] p-1 rounded-lg border border-[var(--outline-variant)]/30 text-xs">
      <button
        type="button"
        onClick={() => handleToggle('light')}
        className={`px-2 py-1 rounded flex items-center gap-1 transition-all cursor-pointer ${
          currentTheme === 'light'
            ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] font-bold shadow-sm'
            : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
        }`}
        title="Light Mode"
      >
        <span className="material-symbols-outlined text-[15px]">light_mode</span>
      </button>

      <button
        type="button"
        onClick={() => handleToggle('dark')}
        className={`px-2 py-1 rounded flex items-center gap-1 transition-all cursor-pointer ${
          currentTheme === 'dark'
            ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] font-bold shadow-sm'
            : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
        }`}
        title="Dark Mode"
      >
        <span className="material-symbols-outlined text-[15px]">dark_mode</span>
      </button>

      <button
        type="button"
        onClick={() => handleToggle('system')}
        className={`px-2 py-1 rounded flex items-center gap-1 transition-all cursor-pointer ${
          currentTheme === 'system'
            ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] font-bold shadow-sm'
            : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
        }`}
        title="System Default"
      >
        <span className="material-symbols-outlined text-[15px]">settings_brightness</span>
      </button>
    </div>
  );
}

