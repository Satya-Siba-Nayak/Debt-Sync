import { createClient } from '../supabase/client';
import { isSameEmail, isSamePhone } from './email-normalize';

export interface ClaimProfileOptions {
  ghostIdToMerge?: string;
  resolutionMode?: 'update' | 'secondary_keep' | 'primary_keep';
  ghostEmail?: string;
}

export async function claimUserProfile(user: any, options?: ClaimProfileOptions) {
  if (!user) return;

  const sessionKey = `debtsync_claimed_${user.id}`;
  if (typeof window !== 'undefined' && !options) {
    try {
      if (sessionStorage.getItem(sessionKey) === '1') {
        return;
      }
    } catch (_) {}
  }

  const supabase = createClient();
  const userPhone = user.user_metadata?.phone || user.phone || null;

  try {
    // 1. Try secure RPC resolve_ghost_profile_by_phone if phone is present
    if (userPhone) {
      try {
        await supabase.rpc('resolve_ghost_profile_by_phone', {
          p_phone: userPhone,
          p_user_id: user.id,
          p_user_email: user.email,
          p_keep_ghost_email_as_secondary: options?.resolutionMode !== 'update',
        });
      } catch (_) {}
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, phone, secondary_emails')
      .eq('id', user.id)
      .single();

    if (!profile) {
      let shadowProfile: any = null;

      // Check specific ghost ID if requested
      if (options?.ghostIdToMerge) {
        const { data: specificGhost } = await supabase
          .from('profiles')
          .select('id, email, phone')
          .eq('id', options.ghostIdToMerge)
          .eq('is_shadow', true)
          .single();
        if (specificGhost) shadowProfile = specificGhost;
      }

      // 1. Direct email match
      if (!shadowProfile) {
        const { data: directShadow } = await supabase
          .from('profiles')
          .select('id, email, phone')
          .eq('email', user.email)
          .eq('is_shadow', true)
          .single();
        shadowProfile = directShadow;
      }

      // 2. Check by email alias or phone match
      if (!shadowProfile) {
        const { data: allShadows } = await supabase
          .from('profiles')
          .select('id, email, phone')
          .eq('is_shadow', true);

        if (allShadows) {
          shadowProfile = allShadows.find((s: any) =>
            isSameEmail(s.email, user.email) ||
            (userPhone && s.phone && isSamePhone(s.phone, userPhone))
          );
        }
      }

      let secondariesToStore: string[] = [];
      if (shadowProfile) {
        // Transfer debts and contacts from shadow to registered user ID
        await supabase.from('debts').update({ lender_id: user.id }).eq('lender_id', shadowProfile.id);
        await supabase.from('debts').update({ borrower_id: user.id }).eq('borrower_id', shadowProfile.id);
        await supabase.from('debts').update({ created_by: user.id }).eq('created_by', shadowProfile.id);
        await supabase.from('contacts').update({ contact_id: user.id }).eq('contact_id', shadowProfile.id);
        await supabase.from('contacts').update({ owner_id: user.id }).eq('owner_id', shadowProfile.id);

        if (
          shadowProfile.email &&
          !shadowProfile.email.endsWith('@phone.debtsync.local') &&
          !isSameEmail(shadowProfile.email, user.email) &&
          options?.resolutionMode !== 'update'
        ) {
          secondariesToStore.push(shadowProfile.email.toLowerCase());
        }

        await supabase.from('profiles').delete().eq('id', shadowProfile.id);
      }

      // Insert new claimed profile
      await supabase.from('profiles').upsert({
        id: user.id,
        email: user.email!,
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        phone: userPhone,
        secondary_emails: secondariesToStore.length > 0 ? secondariesToStore : undefined,
        is_shadow: false,
        claimed_at: new Date().toISOString(),
      });

      await supabase.from('user_settings').upsert({
        user_id: user.id,
      });
    } else {
      // User profile already exists: update phone if missing
      if (!profile.phone && userPhone) {
        await supabase.from('profiles').update({ phone: userPhone }).eq('id', user.id);
      }

      // Check if any shadow debts were assigned to user's email, secondary emails, or phone
      const { data: shadowProfiles } = await supabase
        .from('profiles')
        .select('id, email, phone')
        .eq('is_shadow', true);

      if (shadowProfiles && shadowProfiles.length > 0) {
        const matchingShadows = shadowProfiles.filter((s: any) =>
          (options?.ghostIdToMerge && s.id === options.ghostIdToMerge) ||
          isSameEmail(s.email, user.email) ||
          profile.secondary_emails?.some((sec: string) => isSameEmail(s.email, sec)) ||
          (userPhone && s.phone && isSamePhone(s.phone, userPhone))
        );

        let updatedSecondaries: string[] = Array.isArray(profile.secondary_emails) ? [...profile.secondary_emails] : [];
        let secondariesChanged = false;

        for (const s of matchingShadows) {
          await supabase.from('debts').update({ lender_id: user.id }).eq('lender_id', s.id);
          await supabase.from('debts').update({ borrower_id: user.id }).eq('borrower_id', s.id);
          await supabase.from('debts').update({ created_by: user.id }).eq('created_by', s.id);
          await supabase.from('contacts').update({ contact_id: user.id }).eq('contact_id', s.id);
          await supabase.from('contacts').update({ owner_id: user.id }).eq('owner_id', s.id);

          // Add previous ghost email as secondary if not in 'update' mode
          if (
            s.email &&
            !s.email.endsWith('@phone.debtsync.local') &&
            !isSameEmail(s.email, user.email) &&
            options?.resolutionMode !== 'update'
          ) {
            const cleanGhostMail = s.email.toLowerCase();
            if (!updatedSecondaries.some((sec: string) => isSameEmail(sec, cleanGhostMail))) {
              updatedSecondaries = [...updatedSecondaries, cleanGhostMail];
              secondariesChanged = true;
            }
          }

          await supabase.from('profiles').delete().eq('id', s.id);
        }

        if (secondariesChanged) {
          await supabase.from('profiles').update({ secondary_emails: updatedSecondaries }).eq('id', user.id);
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
