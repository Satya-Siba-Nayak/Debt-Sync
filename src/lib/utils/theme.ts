export type Theme = 'light' | 'dark' | 'system';

const COOKIE_NAME = 'debtsync_theme';
const STORAGE_KEY = 'debtsync_theme';
const LEGACY_STORAGE_KEY = 'theme';

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
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch (_) {}
}

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';

  // 1. Check localStorage first
  try {
    const theme = (localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)) as Theme;
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      return theme;
    }
  } catch (_) {
    // localStorage might be blocked or restricted (e.g. Zen / Firefox strict privacy or container mode)
  }

  // 2. Fall back to persistent cookie
  try {
    const cookieTheme = getCookie(COOKIE_NAME) as Theme;
    if (cookieTheme === 'light' || cookieTheme === 'dark' || cookieTheme === 'system') {
      return cookieTheme;
    }
  } catch (_) {}

  return 'system';
}

export function applyTheme(theme: Theme, syncToDb: boolean = true) {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;

  // 1. Persist to localStorage safely
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    localStorage.setItem(LEGACY_STORAGE_KEY, theme);
  } catch (_) {}

  // 2. Persist to cookie (crucial for Linux / Zen / Firefox privacy modes & initial head script)
  try {
    setCookie(COOKIE_NAME, theme, 365);
  } catch (_) {}

  // 3. Determine if dark mode should be applied
  let isDark = false;
  if (theme === 'dark') {
    isDark = true;
  } else if (theme === 'light') {
    isDark = false;
  } else {
    // 'system'
    try {
      isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (_) {
      isDark = false;
    }
  }

  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  // 4. Broadcast to all ThemeToggle instances across the UI
  try {
    window.dispatchEvent(
      new CustomEvent('debtsync:theme_change', {
        detail: { theme, isDark },
      })
    );
  } catch (_) {}

  // 5. Asynchronously synchronize with Supabase user_settings if authenticated
  if (syncToDb) {
    try {
      import('@/lib/supabase/client').then(({ createClient }) => {
        try {
          const supabase = createClient();
          supabase.auth.getSession().then(({ data }: any) => {
            const userId = data?.session?.user?.id;
            if (userId) {
              supabase
                .from('user_settings')
                .update({ theme_preference: theme })
                .eq('user_id', userId)
                .then(() => {});
            }
          }).catch(() => {});
        } catch (_) {}
      }).catch(() => {});
    } catch (_) {}
  }
}

