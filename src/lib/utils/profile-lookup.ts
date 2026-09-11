import { createClient } from '../supabase/client';
import { Profile } from '../types/database';

/**
 * Finds a profile by ANY identifier: primary email, secondary emails, or phone number.
 */
export async function findProfileByIdentifier(identifier: string): Promise<Profile | null> {
  const clean = identifier.trim().toLowerCase();
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

  // 1. Check primary email
  const { data: byEmail } = await supabase
    .from('profiles')
    .select('*')
    .ilike('email', clean)
    .single();

  if (byEmail) return byEmail as Profile;

  // 2. Check phone if identifier resembles a phone number
  const digits = identifier.replace(/[^\d]/g, '');
  if (digits.length >= 6) {
    const { data: byPhoneExact } = await supabase
      .from('profiles')
      .select('*')
      .eq('phone', identifier.trim())
      .single();

    if (byPhoneExact) return byPhoneExact as Profile;

    // Search by digit substring in phone
    const { data: byPhoneLike } = await supabase
      .from('profiles')
      .select('*')
      .ilike('phone', `%${digits}%`)
      .limit(1);

    if (byPhoneLike && byPhoneLike.length > 0) return byPhoneLike[0] as Profile;
  }

  // 3. Check secondary_emails array (contains clean email)
  const { data: bySecondary } = await supabase
    .from('profiles')
    .select('*')
    .contains('secondary_emails', [clean])
    .single();

  if (bySecondary) return bySecondary as Profile;

  return null;
}
