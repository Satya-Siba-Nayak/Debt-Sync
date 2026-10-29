import { createBrowserClient } from '@supabase/ssr';

let clientInstance: ReturnType<typeof createBrowserClient> | null = null;

const DEFAULT_PUBLIC_SUPABASE_URL = 'https://bqnqtnpeyxruriiwjxbi.supabase.co';
const DEFAULT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxbnF0bnBleXhydXJpaXdqeGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM4NjUsImV4cCI6MjEwNDY5OTg2NX0.TuqQEfoHbQ800oJ9JcjjHaTjUAMZ69BMsUTYQn7U3rU';

function resolvePublicSupabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || DEFAULT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || DEFAULT_PUBLIC_SUPABASE_ANON_KEY;

  return { url, anonKey };
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
