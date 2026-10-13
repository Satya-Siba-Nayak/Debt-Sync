import { createClient } from '../supabase/client';
import { Profile } from '../types/database';
import { canonicalizeEmail, isSameEmail, isSamePhone, normalizePhone } from './email-normalize';

export interface ConflictResult {
  hasConflict: boolean;
  conflictType?: 'email' | 'phone';
  message?: string;
}

/**
 * Finds a profile by ANY identifier: primary email (with alias support), secondary emails, or phone number.
 */
export async function findProfileByIdentifier(identifier: string): Promise<Profile | null> {
  const clean = identifier.trim();
  if (!clean) return null;

  const supabase = createClient();

  // Try RPC function first if available in database
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('find_profile_by_identifier', {
      search_term: clean,
    });
    if (!rpcError && rpcData && rpcData.length > 0) {
      return rpcData[0] as Profile;
    }
  } catch {
    // Fall back to client query
  }

  // 1. Check if identifier is an email
  if (clean.includes('@')) {
    const cleanLower = clean.toLowerCase();
    const canon = canonicalizeEmail(clean);

    // Exact primary email match
    const { data: byEmail } = await supabase
      .from('profiles')
      .select('*')
      .ilike('email', cleanLower)
      .single();

    if (byEmail) return byEmail as Profile;

    // Direct secondary email match
    const { data: bySecondary } = await supabase
      .from('profiles')
      .select('*')
      .contains('secondary_emails', [cleanLower])
      .single();

    if (bySecondary) return bySecondary as Profile;

    // Check all profiles for alias equivalence (e.g. user+tag@gmail.com == user@gmail.com)
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('*');

    if (allProfiles) {
      for (const p of allProfiles) {
        if (isSameEmail(p.email, clean)) return p as Profile;
        if (p.secondary_emails?.some((sec: string) => isSameEmail(sec, clean))) {
          return p as Profile;
        }
      }
    }
  }

  // 2. Check phone if identifier has digits
  const digits = clean.replace(/[^\d]/g, '');
  if (digits.length >= 6) {
    const { data: byPhoneExact } = await supabase
      .from('profiles')
      .select('*')
      .eq('phone', clean)
      .single();

    if (byPhoneExact) return byPhoneExact as Profile;

    // Search by digit substring in phone
    const { data: byPhoneLike } = await supabase
      .from('profiles')
      .select('*')
      .ilike('phone', `%${digits}%`)
      .limit(1);

    if (byPhoneLike && byPhoneLike.length > 0) return byPhoneLike[0] as Profile;

    // Handle numbers with or without country code headers (match last 10 digits)
    if (digits.length >= 10) {
      const last10 = digits.slice(-10);
      const { data: byLast10 } = await supabase
        .from('profiles')
        .select('*')
        .ilike('phone', `%${last10}%`)
        .limit(1);

      if (byLast10 && byLast10.length > 0) return byLast10[0] as Profile;
    }
  }

  return null;
}

/**
 * Checks whether an email (or its alias) or a phone number is already registered
 * by another active user.
 */
export async function checkIdentifierConflict(
  email?: string,
  phone?: string,
  currentUserId?: string
): Promise<ConflictResult> {
  const supabase = createClient();

  const cleanEmail = email?.trim().toLowerCase();
  const cleanPhone = phone?.trim();

  // Try RPC function first
  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('check_identifier_conflict', {
      check_email: cleanEmail || null,
      check_phone: cleanPhone || null,
      current_user_id: currentUserId || null,
    });

    if (!rpcError && rpcResult && typeof rpcResult === 'object') {
      return {
        hasConflict: Boolean(rpcResult.has_conflict),
        conflictType: rpcResult.conflict_type,
        message: rpcResult.message,
      };
    }
  } catch {
    // Fall back to client query
  }

  // Client-side fallback check against profiles table
  try {
    let query = supabase.from('profiles').select('id, email, phone, secondary_emails, is_shadow').eq('is_shadow', false);
    if (currentUserId) {
      query = query.neq('id', currentUserId);
    }
    const { data: profiles, error } = await query;
    if (error || !profiles) return { hasConflict: false };

    // 1. Verify email uniqueness (including aliases like Gmail '+' and '.')
    if (cleanEmail) {
      for (const p of profiles) {
        if (isSameEmail(p.email, cleanEmail)) {
          return {
            hasConflict: true,
            conflictType: 'email',
            message: `An account already exists with this email address (${p.email}) or its alias.`,
          };
        }
        if (p.secondary_emails?.some((sec: string) => isSameEmail(sec, cleanEmail))) {
          return {
            hasConflict: true,
            conflictType: 'email',
            message: 'This email address is already linked as a secondary email to another account.',
          };
        }
      }
    }

    // 2. Verify phone uniqueness
    if (cleanPhone && cleanPhone.replace(/[^\d]/g, '').length >= 6) {
      for (const p of profiles) {
        if (p.phone && isSamePhone(p.phone, cleanPhone)) {
          return {
            hasConflict: true,
            conflictType: 'phone',
            message: 'This phone number is already registered to another account.',
          };
        }
      }
    }
  } catch (err) {
    console.error('Error checking identifier conflict:', err);
  }

  return { hasConflict: false };
}

export interface PhoneCheckResult {
  hasExistingAccount: boolean;
  isGhost: boolean;
  profile?: Profile;
}

/**
 * Checks whether a phone number belongs to an active user or a ghost/shadow account.
 */
export async function checkPhoneRegistrationStatus(
  phone: string,
  email: string
): Promise<PhoneCheckResult> {
  const cleanPhone = phone.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanPhone || cleanPhone.replace(/[^\d]/g, '').length < 7) {
    return { hasExistingAccount: false, isGhost: false };
  }

  const supabase = createClient();
  try {
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, is_shadow, secondary_emails');

    if (!allProfiles) return { hasExistingAccount: false, isGhost: false };

    for (const p of allProfiles) {
      if (p.phone && isSamePhone(p.phone, cleanPhone)) {
        if (p.is_shadow) {
          return {
            hasExistingAccount: true,
            isGhost: true,
            profile: p as Profile,
          };
        } else {
          // Active non-ghost user
          if (!isSameEmail(p.email, cleanEmail)) {
            return {
              hasExistingAccount: true,
              isGhost: false,
              profile: p as Profile,
            };
          }
        }
      }
    }
  } catch (err) {
    console.error('Error checking phone registration status:', err);
  }

  return { hasExistingAccount: false, isGhost: false };
}

/**
 * Searches profiles by name, email, or phone prefix/substring.
 */
export async function searchProfiles(searchTerm: string, limit = 5): Promise<Profile[]> {
  const clean = searchTerm.trim();
  if (!clean || clean.length < 2) return [];

  const supabase = createClient();
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, avatar_url, is_shadow')
      .or(`full_name.ilike.%${clean}%,email.ilike.%${clean}%,phone.ilike.%${clean}%`)
      .limit(limit);

    if (error || !data) return [];
    return data as Profile[];
  } catch (err) {
    console.error('Error searching profiles:', err);
    return [];
  }
}
