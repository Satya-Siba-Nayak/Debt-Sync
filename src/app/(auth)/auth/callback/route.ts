import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if this user has a profile, if not create one
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
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
            // Claim shadow profile
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
            // Create new profile
            await supabase.from('profiles').insert({
              id: user.id,
              email: user.email!,
              full_name: user.user_metadata?.full_name || 'User',
              phone: user.user_metadata?.phone || null,
            });
          }

          // Create default settings
          await supabase.from('user_settings').insert({
            user_id: user.id,
          });
        }
      }

      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Could+not+authenticate`);
}
