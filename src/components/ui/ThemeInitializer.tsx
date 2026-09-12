'use client';

import { useLayoutEffect, useEffect } from 'react';
import { applyTheme, getStoredTheme } from '@/lib/utils/theme';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function ThemeInitializer() {
  useIsomorphicLayoutEffect(() => {
    // Re-assert active theme immediately on client hydration
    const stored = getStoredTheme();
    applyTheme(stored);
  }, []);

  return null;
}
