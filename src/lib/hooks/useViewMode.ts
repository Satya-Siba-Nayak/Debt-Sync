'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCachedUserProfile } from '@/lib/utils/auth-session';

export type ViewMode = 'admin' | 'user';

export const VIEW_MODE_STORAGE_KEY = 'debtsync_view_mode';
export const VIEW_MODE_EVENT = 'debtsync:view_mode_changed';

function readStoredMode(): ViewMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return v === 'admin' || v === 'user' ? v : null;
  } catch {
    return null;
  }
}

function resolveIsAdmin(isAdmin: boolean | undefined): boolean {
  // The DB-backed prop is authoritative once known.
  if (isAdmin !== undefined) return Boolean(isAdmin);
  // While the profile is still loading, trust only the cached profile.
  if (typeof window === 'undefined') return false;
  return Boolean(getCachedUserProfile()?.is_admin);
}

/**
 * Shared admin/user view-mode state for layout chrome (Sidebar, TopBar, BottomNav).
 *
 * - `isAdmin`: true only when the signed-in account actually has `profiles.is_admin`.
 * - `viewMode`: the admin's chosen view. Always 'user' for non-admins.
 * - `inAdminMode`: `isAdmin && viewMode === 'admin'`.
 */
export function useViewMode(isAdminProp: boolean | undefined) {
  const [isAdmin, setIsAdmin] = useState<boolean>(() => resolveIsAdmin(isAdminProp));
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (!resolveIsAdmin(isAdminProp)) return 'user';
    return readStoredMode() ?? 'admin';
  });

  // Sync privilege with the authoritative prop.
  useEffect(() => {
    const next = resolveIsAdmin(isAdminProp);
    setIsAdmin(next);
    if (!next) {
      setViewModeState('user');
      // Remove any stale admin preference left on this device by another account.
      if (isAdminProp === false && typeof window !== 'undefined') {
        try {
          localStorage.removeItem(VIEW_MODE_STORAGE_KEY);
        } catch {}
      }
    } else {
      setViewModeState(readStoredMode() ?? 'admin');
    }
  }, [isAdminProp]);

  // Listen for cross-component changes.
  useEffect(() => {
    const handleModeChange = (e: Event) => {
      const mode = (e as CustomEvent).detail?.mode;
      if (mode === 'admin' || mode === 'user') setViewModeState(mode);
    };
    const handleUserUpdated = (e: Event) => {
      const flag = (e as CustomEvent).detail?.isAdmin;
      if (flag !== undefined) {
        setIsAdmin(Boolean(flag));
        if (!flag) setViewModeState('user');
      }
    };
    window.addEventListener(VIEW_MODE_EVENT, handleModeChange);
    window.addEventListener('debtsync:user_updated', handleUserUpdated);
    return () => {
      window.removeEventListener(VIEW_MODE_EVENT, handleModeChange);
      window.removeEventListener('debtsync:user_updated', handleUserUpdated);
    };
  }, []);

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      if (!isAdmin) return;
      setViewModeState(mode);
      try {
        localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
      } catch {}
      window.dispatchEvent(new CustomEvent(VIEW_MODE_EVENT, { detail: { mode } }));
    },
    [isAdmin]
  );

  const toggleViewMode = useCallback(() => {
    setViewMode(viewMode === 'admin' ? 'user' : 'admin');
  }, [setViewMode, viewMode]);

  const effectiveMode: ViewMode = isAdmin ? viewMode : 'user';

  return {
    isAdmin,
    viewMode: effectiveMode,
    inAdminMode: isAdmin && effectiveMode === 'admin',
    setViewMode,
    toggleViewMode,
  };
}
