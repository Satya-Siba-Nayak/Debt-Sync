'use client';

import { useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { isSameEmail, isSamePhone } from '@/lib/utils/email-normalize';

function CallbackHandler() {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function processAuth() {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        // Wait briefly in case Supabase is parsing hash fragments
        const { data: authListener } = supabase.auth.onAuthStateChange(async (event: any, currentSession: any) => {
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
        let shadowProfile: any = null;

        // 1. Direct email match
        const { data: directShadow } = await supabase
          .from('profiles')
          .select('id, email, phone')
          .eq('email', user.email)
          .eq('is_shadow', true)
          .single();
        shadowProfile = directShadow;

        // 2. Check by email alias or phone match
        if (!shadowProfile) {
          const { data: allShadows } = await supabase
            .from('profiles')
            .select('id, email, phone')
            .eq('is_shadow', true);

          if (allShadows) {
            shadowProfile = allShadows.find((s: any) => 
              isSameEmail(s.email, user.email) ||
              (user.user_metadata?.phone && s.phone && isSamePhone(s.phone, user.user_metadata.phone))
            );
          }
        }

        if (shadowProfile) {
          // Transfer debts and contacts from shadow to registered user ID
          await supabase.from('debts').update({ lender_id: user.id }).eq('lender_id', shadowProfile.id);
          await supabase.from('debts').update({ borrower_id: user.id }).eq('borrower_id', shadowProfile.id);
          await supabase.from('contacts').update({ contact_id: user.id }).eq('contact_id', shadowProfile.id);
          await supabase.from('profiles').delete().eq('id', shadowProfile.id);
        }

        // Insert new claimed profile
        await supabase.from('profiles').upsert({
          id: user.id,
          email: user.email!,
          full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
          phone: user.user_metadata?.phone || null,
          is_shadow: false,
          claimed_at: new Date().toISOString(),
        });

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
