'use client';

import { useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function CallbackHandler() {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function processAuth() {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        // Wait briefly in case Supabase is parsing hash fragments
        const { data: authListener } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
          if (event === 'SIGNED_IN' && currentSession) {
            await handleProfile(currentSession.user);
            router.replace('/');
          }
        });

        setTimeout(() => {
          router.replace('/login');
        }, 3000);
        return;
      }

      await handleProfile(session.user);
      router.replace('/');
    }

    async function handleProfile(user: any) {
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();

      if (!profile) {
        // Check for shadow profile with same email
        const { data: shadowProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', user.email)
          .eq('is_shadow', true)
          .single();

        if (shadowProfile) {
          await supabase
            .from('profiles')
            .update({
              id: user.id,
              is_shadow: false,
              claimed_at: new Date().toISOString(),
              full_name: user.user_metadata?.full_name || 'User',
              phone: user.user_metadata?.phone || null,
            })
            .eq('id', shadowProfile.id);
        } else {
          await supabase.from('profiles').insert({
            id: user.id,
            email: user.email!,
            full_name: user.user_metadata?.full_name || 'User',
            phone: user.user_metadata?.phone || null,
          });
        }

        await supabase.from('user_settings').upsert({
          user_id: user.id,
        });
      }
    }

    processAuth();
  }, [router, supabase]);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="text-center font-mono text-xs text-on-surface-variant flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <span>Authenticating and syncing your ledger...</span>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <CallbackHandler />
    </Suspense>
  );
}
