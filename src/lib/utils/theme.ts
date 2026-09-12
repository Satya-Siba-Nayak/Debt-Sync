export type Theme = 'light' | 'dark' | 'system';

const COOKIE_NAME = 'debtsync_theme_v2';
const STORAGE_KEY = 'debtsync_theme_v2';
const LEGACY_COOKIE = 'debtsync_theme';
const LEGACY_STORAGE = 'debtsync_theme';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[1]) : null;
  } catch (_) {
    return null;
  }
}

function setCookie(name: string, value: string, days: number = 365): void {
  if (typeof document === 'undefined') return;
  try {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; max-age=${days * 86400}; path=/; SameSite=Lax`;
  } catch (_) {}
}

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';

  // 1. Check debtsync_theme_v2 in localStorage first
  try {
    const theme = localStorage.getItem(STORAGE_KEY) as Theme;
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      return theme;
    }
  } catch (_) {}

  // 2. Fall back to persistent cookie v2
  try {
    const cookieTheme = getCookie(COOKIE_NAME) as Theme;
    if (cookieTheme === 'light' || cookieTheme === 'dark' || cookieTheme === 'system') {
      return cookieTheme;
    }
  } catch (_) {}

  // 3. Migrate from legacy debtsync_theme if set
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE) || getCookie(LEGACY_COOKIE);
    if (legacy === 'dark' || legacy === 'light' || legacy === 'system') {
      localStorage.setItem(STORAGE_KEY, legacy);
      setCookie(COOKIE_NAME, legacy);
      return legacy as Theme;
    }
  } catch (_) {}

  // Default is 'system' (device default)
  return 'system';
}

export function applyTheme(theme: Theme) {
  if (typeof window === 'undefined') return;

  // Disconnect temporary hydration observer if active
  if ((window as any).__debtsync_theme_observer) {
    try {
      (window as any).__debtsync_theme_observer.disconnect();
      (window as any).__debtsync_theme_observer = null;
    } catch (_) {}
  }

  const root = document.documentElement;

  // 1. Persist to localStorage safely
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    localStorage.setItem(LEGACY_STORAGE, theme);
    localStorage.removeItem('theme');
  } catch (_) {}

  // 2. Persist to cookie (for SSR / head script on reload)
  try {
    setCookie(COOKIE_NAME, theme, 365);
    setCookie(LEGACY_COOKIE, theme, 365);
  } catch (_) {}

  // 3. Determine if dark mode should be applied
  let isDark = false;
  if (theme === 'dark') {
    isDark = true;
  } else if (theme === 'system') {
    try {
      isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (_) {
      isDark = false;
    }
  } else {
    // 'light'
    isDark = false;
  }

  if (isDark) {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.setAttribute('data-theme', 'light');
    root.style.colorScheme = 'light';
  }

  // 4. Broadcast to all ThemeToggle instances and charts across the UI
  try {
    window.dispatchEvent(
      new CustomEvent('debtsync:theme_change', {
        detail: { theme, isDark },
      })
    );
  } catch (_) {}
}

