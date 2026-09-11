/**
 * Auth session and user profile caching utilities.
 * Ensures page reloads are instantaneous without waiting for remote auth network roundtrips.
 */

const PROFILE_CACHE_KEY = 'debtsync_cached_profile';

export interface CachedProfile {
  id: string;
  full_name?: string;
  email?: string;
  avatar_url?: string | null;
  recent_custom_avatars?: string[];
}

/**
 * Resolves the authenticated user as fast as possible on page loads and reloads.
 * Reads the cached session from persistent cookies/storage in 0ms,
 * falling back to a full network verification only if needed.
 */
export async function getCurrentUserFast(supabase: any) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      return session.user;
    }
  } catch (_) {}

  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user || null;
  } catch (_) {
    return null;
  }
}

/**
 * Retrieves the locally cached profile for instantaneous frame-0 rendering.
 */
export function getCachedUserProfile(): CachedProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

/**
 * Stores the user profile in local cache to eliminate flash-of-empty-state on reload.
 */
export function setCachedUserProfile(profile: CachedProfile | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (profile) {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch (_) {}
}

/**
 * Clears all local auth cache on user sign-out.
 */
export function clearAuthSessionData(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch (_) {}
}
