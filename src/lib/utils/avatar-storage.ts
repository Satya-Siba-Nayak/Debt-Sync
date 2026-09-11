import { AVATAR_PRESETS } from '@/components/ui/Avatar';

/**
 * Checks if a given avatar URL is one of the built-in presets or DiceBear SVGs.
 */
export function isPresetAvatar(url: string | null): boolean {
  if (!url) return false;
  return AVATAR_PRESETS.some((p) => p.url === url) || url.includes('api.dicebear.com');
}

/**
 * Extracts the file path inside the avatars bucket (e.g. "<userId>/<timestamp>.jpg") from a URL.
 */
export function getAvatarStoragePath(url: string, bucket: string = 'avatars'): string | null {
  if (!url || isPresetAvatar(url) || url.startsWith('data:')) return null;

  // Handles URLs like .../storage/v1/object/public/avatars/USER_ID/FILENAME.jpg
  const marker = `/${bucket}/`;
  const markerIdx = url.indexOf(marker);
  if (markerIdx !== -1) {
    const afterMarker = url.substring(markerIdx + marker.length);
    return decodeURIComponent(afterMarker.split('?')[0]);
  }

  // Fallback: match pattern <userId>/<fileName>
  const match = url.match(/([0-9a-fA-F-]{36}\/[^/?#]+)/);
  if (match) return match[1];

  return null;
}

/**
 * Deletes a specific custom avatar file from the Supabase storage server.
 */
export async function deleteCustomAvatarFile(
  supabase: any,
  userId: string,
  url: string
): Promise<boolean> {
  if (!url || !userId || isPresetAvatar(url) || url.startsWith('data:')) {
    return false;
  }

  try {
    const storagePath = getAvatarStoragePath(url, 'avatars');
    const pathToDelete = storagePath || `${userId}/${url.split('/').pop()?.split('?')[0]}`;

    if (pathToDelete) {
      const { error } = await supabase.storage.from('avatars').remove([pathToDelete]);
      if (error) {
        console.warn('Notice deleting avatar file from storage:', error.message);
        return false;
      }
      return true;
    }
  } catch (err) {
    console.warn('Error during avatar file deletion:', err);
  }
  return false;
}

/**
 * Manages the list of recent custom avatars (strictly max 2).
 * When a new custom photo is uploaded, any custom photos beyond the last 2
 * are automatically purged and deleted from the Supabase storage server.
 */
export async function manageCustomAvatarsOnUpload(
  supabase: any,
  userId: string,
  newUrl: string,
  currentRecent: string[] = []
): Promise<string[]> {
  if (!userId || !newUrl) return currentRecent;

  // Presets are not custom uploaded photos
  if (isPresetAvatar(newUrl)) {
    return currentRecent;
  }

  // Deduplicate and prepend new URL to recent list
  const filtered = (currentRecent || []).filter((u) => u && u !== newUrl && !isPresetAvatar(u));
  const fullList = [newUrl, ...filtered];

  // Strictly keep only the last 2
  const kept = fullList.slice(0, 2);
  const evicted = fullList.slice(2);

  // 1. Delete evicted URLs from Supabase storage
  for (const oldUrl of evicted) {
    await deleteCustomAvatarFile(supabase, userId, oldUrl);
  }

  // 2. Server storage check: ensure the storage folder for this user has at most 2 files
  try {
    const { data: storageFiles } = await supabase.storage
      .from('avatars')
      .list(userId, { sortBy: { column: 'created_at', order: 'desc' } });

    if (storageFiles && storageFiles.length > 2) {
      // Sort newest first; files beyond index 1 must be deleted
      const excessFiles = storageFiles.slice(2).map((f: any) => `${userId}/${f.name}`);
      if (excessFiles.length > 0) {
        await supabase.storage.from('avatars').remove(excessFiles);
      }
    }
  } catch (storageListErr) {
    console.warn('Storage folder sync notice:', storageListErr);
  }

  // Sync to localStorage as fast client-side cache
  setLocalRecentAvatars(userId, kept);

  return kept;
}

/**
 * Removes a custom avatar from both the recent list and the server storage.
 */
export async function removeCustomAvatar(
  supabase: any,
  userId: string,
  urlToRemove: string,
  currentRecent: string[] = []
): Promise<string[]> {
  if (!userId || !urlToRemove) return currentRecent;

  // Delete file from server storage
  await deleteCustomAvatarFile(supabase, userId, urlToRemove);

  const updated = (currentRecent || []).filter((u) => u !== urlToRemove);
  setLocalRecentAvatars(userId, updated);
  return updated;
}

/**
 * LocalStorage cache helpers for instant UI responsiveness
 */
export function getLocalRecentAvatars(userId: string): string[] {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const raw = localStorage.getItem(`debtsync_recent_avatars_${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(0, 2);
    }
  } catch (_) {}
  return [];
}

export function setLocalRecentAvatars(userId: string, urls: string[]): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    localStorage.setItem(`debtsync_recent_avatars_${userId}`, JSON.stringify(urls.slice(0, 2)));
  } catch (_) {}
}
