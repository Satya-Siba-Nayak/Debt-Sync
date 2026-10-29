'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { claimUserProfile } from '@/lib/utils/claim-profile';

function sanitizeRedirectDest(raw: string | null | undefined): string {
  if (!raw) return '/dash';
  let target = raw.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  try {
    if (target.includes('%2F') || target.includes('%2f') || target.includes('%5C') || target.includes('%5c')) {
      target = decodeURIComponent(target);
    }
  } catch (_) {}

  if (target.startsWith('http://') || target.startsWith('https://')) {
    try {
      const parsed = new URL(target);
      const rel = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      if (rel.startsWith('/') && !rel.startsWith('//') && !rel.startsWith('/\\')) {
        return rel === '/' ? '/dash' : rel;
      }
      return '/dash';
    } catch (_) {
      return '/dash';
    }
  }

  if (target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\')) {
    return target === '/' ? '/dash' : target;
  }
  return '/dash';
}

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  useEffect(() => {
    const rawNext = searchParams.get('next');
    const redirectDest = sanitizeRedirectDest(rawNext);
    let authSub: { unsubscribe: () => void } | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    async function processAuth() {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        // Wait briefly in case Supabase is parsing hash fragments or PKCE code
        const { data: authListener } = supabase.auth.onAuthStateChange(async (event: any, currentSession: any) => {
          if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && currentSession?.user) {
            if (fallbackTimer) clearTimeout(fallbackTimer);
            await claimUserProfile(currentSession.user);
            router.replace(redirectDest);
          }
        });
        authSub = authListener?.subscription || null;

        fallbackTimer = setTimeout(() => {
          router.replace(rawNext ? `/login?next=${encodeURIComponent(rawNext)}` : '/login');
        }, 3500);
        return;
      }

      await claimUserProfile(session.user);
      router.replace(redirectDest);
    }

    processAuth();

    return () => {
      if (authSub) authSub.unsubscribe();
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [router, searchParams, supabase]);

  return (
    <div className="min-h-screen bg-[var(--surface)] flex items-center justify-center p-6">
      <div className="text-center font-mono text-xs text-[var(--on-surface-variant)] flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin" />
        <span>Authenticating and syncing your ledger...</span>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface)]" />}>
      <CallbackHandler />
    </Suspense>
  );
}
