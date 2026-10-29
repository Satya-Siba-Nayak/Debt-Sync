import { createBrowserClient } from '@supabase/ssr';

let clientInstance: ReturnType<typeof createBrowserClient> | null = null;

function resolvePublicSupabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';

  if (url && anonKey) {
    return { url, anonKey };
  }

  // Static export runs a one-pass SSR prerender during `next build`. Cloudflare must supply
  // NEXT_PUBLIC_* at build time (see wrangler.toml [vars]); this fallback avoids hard failures.
  if (typeof window === 'undefined') {
    return {
      url: url || 'https://placeholder.supabase.co',
      anonKey:
        anonKey ||
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NDE3NjcyMDAsImV4cCI6MTk2NzM0MzIwMH0.placeholder',
    };
  }

  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Configure them for the Pages build (wrangler.toml [vars] or Cloudflare dashboard).'
  );
}

export function createClient() {
  if (clientInstance) return clientInstance;

  const { url, anonKey } = resolvePublicSupabaseConfig();

  clientInstance = createBrowserClient(url, anonKey, {
    isSingleton: true,
    cookieOptions: {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      path: '/',
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return clientInstance;
}
