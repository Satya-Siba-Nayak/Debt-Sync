import { createClient } from '../supabase/client';
import { isSameEmail, isSamePhone } from './email-normalize';

export async function claimUserProfile(user: any) {
  if (!user) return;

  const sessionKey = `debtsync_claimed_${user.id}`;
  if (typeof window !== 'undefined') {
    try {
      if (sessionStorage.getItem(sessionKey) === '1') {
        return;
      }
    } catch (_) {}
  }

  const supabase = createClient();

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, secondary_emails')
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
    } else {
      // User profile already exists: check if any shadow debts were assigned to user's email or secondary emails
      const { data: shadowProfiles } = await supabase
        .from('profiles')
        .select('id, email')
        .eq('is_shadow', true);

      if (shadowProfiles) {
        const matchingShadows = shadowProfiles.filter((s: any) =>
          isSameEmail(s.email, user.email) ||
          profile.secondary_emails?.some((sec: string) => isSameEmail(s.email, sec))
        );

        for (const s of matchingShadows) {
          await supabase.from('debts').update({ lender_id: user.id }).eq('lender_id', s.id);
          await supabase.from('debts').update({ borrower_id: user.id }).eq('borrower_id', s.id);
          await supabase.from('contacts').update({ contact_id: user.id }).eq('contact_id', s.id);
          await supabase.from('profiles').delete().eq('id', s.id);
        }
      }
    }

    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(sessionKey, '1');
      } catch (_) {}
    }
  } catch (err) {
    console.error('Error claiming user profile:', err);
  }
}
