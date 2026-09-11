export type Theme = 'light' | 'dark' | 'system';

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const theme = (localStorage.getItem('debtsync_theme') || localStorage.getItem('theme')) as Theme;
    return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme) {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;
  try {
    localStorage.setItem('debtsync_theme', theme);
    localStorage.setItem('theme', theme);
  } catch {
    // ignore
  }

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && systemDark);

  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  // Broadcast to all ThemeToggle instances across the UI
  try {
    window.dispatchEvent(
      new CustomEvent('debtsync:theme_change', {
        detail: { theme, isDark },
      })
    );
  } catch (_) {}
}

