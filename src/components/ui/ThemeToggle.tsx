'use client';

import { useEffect, useState } from 'react';
import { applyTheme, getStoredTheme, Theme } from '@/lib/utils/theme';

export function ThemeToggle() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    const stored = getStoredTheme();
    setCurrentTheme(stored);
    applyTheme(stored);

    // Listen for theme updates triggered from other ThemeToggle instances or settings
    const handleThemeChange = (e: any) => {
      if (e.detail?.theme) {
        setCurrentTheme(e.detail.theme);
      }
    };
    window.addEventListener('debtsync:theme_change', handleThemeChange);

    // Listen for OS system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => {
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

