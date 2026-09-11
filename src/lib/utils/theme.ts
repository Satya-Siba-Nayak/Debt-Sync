export type Theme = 'light' | 'dark' | 'system';

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const theme = localStorage.getItem('theme') as Theme;
    return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme) {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // ignore
  }

  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    // system
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (systemDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}
