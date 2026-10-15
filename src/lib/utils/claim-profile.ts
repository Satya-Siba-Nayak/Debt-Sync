import { createClient } from '../supabase/client';
import { isSameEmail, isSamePhone } from './email-normalize';

const SYSTEM_PURGED_USER_ID = '00000000-0000-0000-0000-000000000001';

export interface ClaimProfileOptions {
  ghostIdToMerge?: string;
  resolutionMode?: 'update' | 'secondary_keep' | 'primary_keep';
  ghostEmail?: string;
}

async function mergeShadowIntoUserClientFallback(
  supabase: any,
  shadowId: string,
  userId: string
) {
  if (!shadowId || shadowId === SYSTEM_PURGED_USER_ID || shadowId === userId) return;

  await supabase.from('debts').update({ lender_id: userId }).eq('lender_id', shadowId);
  await supabase.from('debts').update({ borrower_id: userId }).eq('borrower_id', shadowId);
  await supabase.from('debts').update({ created_by: userId }).eq('created_by', shadowId);
  await supabase.from('payments').update({ paid_by: userId }).eq('paid_by', shadowId);
  await supabase.from('payments').update({ verified_by: userId }).eq('verified_by', shadowId);

  // Deduplicate contacts before updating to avoid 23505 unique constraint errors
  try {
    // Remove self-referential rows
    await supabase
      .from('contacts')
      .delete()
      .or(`and(owner_id.eq.${userId},contact_id.eq.${shadowId}),and(owner_id.eq.${shadowId},contact_id.eq.${userId})`);

    // Fetch existing contacts involving userId so we can remove duplicates on shadowId
    const { data: userContacts } = await supabase
      .from('contacts')
      .select('owner_id, contact_id')
      .or(`owner_id.eq.${userId},contact_id.eq.${userId}`);

    if (userContacts && userContacts.length > 0) {
      const ownersWhoHaveUser = userContacts
        .filter((c: any) => c.contact_id === userId)
        .map((c: any) => c.owner_id);
      const contactsOwnedByUser = userContacts
        .filter((c: any) => c.owner_id === userId)
        .map((c: any) => c.contact_id);

      if (ownersWhoHaveUser.length > 0) {
        await supabase
          .from('contacts')
          .delete()
          .eq('contact_id', shadowId)
          .in('owner_id', ownersWhoHaveUser);
      }
      if (contactsOwnedByUser.length > 0) {
        await supabase
          .from('contacts')
          .delete()
          .eq('owner_id', shadowId)
          .in('contact_id', contactsOwnedByUser);
      }
    }
  } catch (_) {}

  await supabase.from('contacts').update({ contact_id: userId }).eq('contact_id', shadowId);
  await supabase.from('contacts').update({ owner_id: userId }).eq('owner_id', shadowId);
  await supabase.from('profiles').delete().eq('id', shadowId);
}

export async function claimUserProfile(user: any, options?: ClaimProfileOptions) {
  if (!user) return;

  // Fallback to user_metadata if options weren't passed directly (e.g., via email confirmation callback)
  const effectiveOptions: ClaimProfileOptions = {
    ghostIdToMerge: options?.ghostIdToMerge || user.user_metadata?.resolve_ghost_id || undefined,
    resolutionMode: options?.resolutionMode || user.user_metadata?.resolve_mode || undefined,
    ghostEmail: options?.ghostEmail || user.user_metadata?.ghost_email || undefined,
  };

  const sessionKey = `debtsync_claimed_${user.id}`;
  if (typeof window !== 'undefined' && !options && !effectiveOptions.ghostIdToMerge) {
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
          p_keep_ghost_email_as_secondary: effectiveOptions.resolutionMode !== 'update',
        });
      } catch (_) {}
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, phone, secondary_emails')
      .eq('id', user.id)
      .single();

    if (!profile) {
      let shadowProfile: any = null;

      // Check specific ghost ID if requested
      if (effectiveOptions.ghostIdToMerge && effectiveOptions.ghostIdToMerge !== SYSTEM_PURGED_USER_ID) {
        const { data: specificGhost } = await supabase
          .from('profiles')
          .select('id, email, phone')
          .eq('id', effectiveOptions.ghostIdToMerge)
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
          .neq('id', SYSTEM_PURGED_USER_ID)
          .single();
        shadowProfile = directShadow;
      }

      // 2. Check by email alias or phone match
      if (!shadowProfile) {
        const { data: allShadows } = await supabase
          .from('profiles')
          .select('id, email, phone')
          .eq('is_shadow', true)
          .neq('id', SYSTEM_PURGED_USER_ID);

        if (allShadows) {
          shadowProfile = allShadows.find((s: any) =>
            isSameEmail(s.email, user.email) ||
            (userPhone && s.phone && isSamePhone(s.phone, userPhone))
          );
        }
      }

      const secondariesToStore: string[] = [];
      let primaryEmailToStore = user.email!;

      if (shadowProfile) {
        await mergeShadowIntoUserClientFallback(supabase, shadowProfile.id, user.id);

        const ghostMail = shadowProfile.email?.toLowerCase()?.trim();
        const isRealGhostEmail =
          ghostMail &&
          !ghostMail.endsWith('@phone.debtsync.local') &&
          !ghostMail.endsWith('@system.debtsync.local') &&
          !isSameEmail(ghostMail, user.email);

        if (isRealGhostEmail) {
          if (effectiveOptions.resolutionMode === 'primary_keep') {
            primaryEmailToStore = ghostMail;
            if (user.email) secondariesToStore.push(user.email.toLowerCase().trim());
          } else if (effectiveOptions.resolutionMode !== 'update') {
            secondariesToStore.push(ghostMail);
          }
        }
      } else if (
        effectiveOptions.ghostEmail &&
        !effectiveOptions.ghostEmail.endsWith('@phone.debtsync.local') &&
        !isSameEmail(effectiveOptions.ghostEmail, user.email)
      ) {
        const cleanGhost = effectiveOptions.ghostEmail.toLowerCase().trim();
        if (effectiveOptions.resolutionMode === 'primary_keep') {
          primaryEmailToStore = cleanGhost;
          if (user.email) secondariesToStore.push(user.email.toLowerCase().trim());
        } else if (effectiveOptions.resolutionMode !== 'update') {
          secondariesToStore.push(cleanGhost);
        }
      }

      // Insert new claimed profile
      await supabase.from('profiles').upsert({
        id: user.id,
        email: primaryEmailToStore,
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
        .eq('is_shadow', true)
        .neq('id', SYSTEM_PURGED_USER_ID);

      let updatedSecondaries: string[] = Array.isArray(profile.secondary_emails) ? [...profile.secondary_emails] : [];
      let secondariesChanged = false;
      let nextPrimaryEmail = profile.email || user.email;
      let primaryEmailChanged = false;

      if (shadowProfiles && shadowProfiles.length > 0) {
        const matchingShadows = shadowProfiles.filter((s: any) =>
          (effectiveOptions.ghostIdToMerge && s.id === effectiveOptions.ghostIdToMerge) ||
          isSameEmail(s.email, user.email) ||
          profile.secondary_emails?.some((sec: string) => isSameEmail(s.email, sec)) ||
          (userPhone && s.phone && isSamePhone(s.phone, userPhone))
        );

        for (const s of matchingShadows) {
          await mergeShadowIntoUserClientFallback(supabase, s.id, user.id);

          const cleanGhostMail = s.email?.toLowerCase()?.trim();
          const isRealGhostEmail =
            cleanGhostMail &&
            !cleanGhostMail.endsWith('@phone.debtsync.local') &&
            !cleanGhostMail.endsWith('@system.debtsync.local') &&
            !isSameEmail(cleanGhostMail, user.email);

          if (isRealGhostEmail) {
            if (effectiveOptions.resolutionMode === 'primary_keep') {
              nextPrimaryEmail = cleanGhostMail;
              primaryEmailChanged = true;
              const authMail = user.email?.toLowerCase()?.trim();
              if (authMail && !updatedSecondaries.some((sec: string) => isSameEmail(sec, authMail))) {
                updatedSecondaries = [...updatedSecondaries, authMail];
                secondariesChanged = true;
              }
            } else if (effectiveOptions.resolutionMode !== 'update') {
              if (!updatedSecondaries.some((sec: string) => isSameEmail(sec, cleanGhostMail))) {
                updatedSecondaries = [...updatedSecondaries, cleanGhostMail];
                secondariesChanged = true;
              }
            }
          }
        }
      }

      // Also handle case where RPC already merged the ghost before the client fallback ran,
      // and resolutionMode was 'primary_keep'
      if (
        effectiveOptions.resolutionMode === 'primary_keep' &&
        effectiveOptions.ghostEmail &&
        !effectiveOptions.ghostEmail.endsWith('@phone.debtsync.local') &&
        !isSameEmail(effectiveOptions.ghostEmail, user.email)
      ) {
        const cleanGhost = effectiveOptions.ghostEmail.toLowerCase().trim();
        nextPrimaryEmail = cleanGhost;
        primaryEmailChanged = true;
        const authMail = user.email?.toLowerCase()?.trim();
        if (authMail && !updatedSecondaries.some((sec: string) => isSameEmail(sec, authMail))) {
          updatedSecondaries = [...updatedSecondaries.filter((sec: string) => !isSameEmail(sec, cleanGhost)), authMail];
          secondariesChanged = true;
        }
      }

      if (secondariesChanged || primaryEmailChanged) {
        const updatePayload: any = {};
        if (secondariesChanged) updatePayload.secondary_emails = updatedSecondaries;
        if (primaryEmailChanged) updatePayload.email = nextPrimaryEmail;
        await supabase.from('profiles').update(updatePayload).eq('id', user.id);
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
