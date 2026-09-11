'use client';

import React, { useState } from 'react';

interface AvatarProps {
  src?: string | null;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[10px] rounded-lg',
  sm: 'w-8 h-8 text-xs rounded-xl',
  md: 'w-11 h-11 text-sm rounded-xl',
  lg: 'w-14 h-14 text-lg rounded-2xl',
  xl: 'w-20 h-20 text-2xl rounded-3xl',
};

// Curated stylish avatar presets that look stunning on both dark and light modes
export const AVATAR_PRESETS = [
  // Robot / Tech presets (Bottts)
  { id: 'preset-1', label: 'Teal Bot', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=DebtSyncTeal' },
  { id: 'preset-2', label: 'Cyber Bot', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=DebtSyncCyber' },
  { id: 'preset-3', label: 'Crimson Tech', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=DebtSyncCrimson' },
  { id: 'preset-4', label: 'Mint Android', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=DebtSyncMint' },
  { id: 'preset-5', label: 'Solar Bot', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=DebtSyncSolar' },

  // Modern Geometric & Abstract (Shapes)
  { id: 'preset-6', label: 'Emerald Shapes', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=DebtSyncEmerald' },
  { id: 'preset-7', label: 'Amber Bauhaus', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=DebtSyncAmber' },
  { id: 'preset-8', label: 'Violet Mosaic', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=DebtSyncViolet' },
  { id: 'preset-9', label: 'Sunset Shapes', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=DebtSyncSunset' },
  { id: 'preset-10', label: 'Cosmic Prisms', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=DebtSyncCosmic' },
  { id: 'preset-11', label: 'Neon Geo', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=DebtSyncNeon' },

  // Notion-style sketches (Notionists)
  { id: 'preset-12', label: 'Gold Minimal', url: 'https://api.dicebear.com/7.x/notionists/svg?seed=DebtSyncGold' },
  { id: 'preset-13', label: 'Cobalt Notion', url: 'https://api.dicebear.com/7.x/notionists/svg?seed=DebtSyncCobalt' },
  { id: 'preset-14', label: 'Sage Minimal', url: 'https://api.dicebear.com/7.x/notionists/svg?seed=DebtSyncSage' },

  // Illustrated Personas (Avataaars)
  { id: 'preset-15', label: 'Cyan Persona', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=DebtSyncCyan' },
  { id: 'preset-16', label: 'Indigo Persona', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=DebtSyncIndigo' },
  { id: 'preset-17', label: 'Ruby Adventurer', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=DebtSyncRuby' },
  { id: 'preset-18', label: 'Onyx Persona', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=DebtSyncOnyx' },

  // Anime / Clean Portraits (Lorelei)
  { id: 'preset-19', label: 'Electric Blue', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=DebtSyncBlue' },
  { id: 'preset-20', label: 'Jade Portrait', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=DebtSyncJade' },
  { id: 'preset-21', label: 'Coral Portrait', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=DebtSyncCoral' },

  // Retro Pixel Art (Pixel Art)
  { id: 'preset-22', label: 'Neon Pixel', url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=DebtSyncPixel' },
  { id: 'preset-23', label: 'Cyberpunk Pixel', url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=DebtSyncCyberpunk' },
  { id: 'preset-24', label: 'Arcade Pixel', url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=DebtSyncArcade' },
];

export function Avatar({
  src,
  name = 'User',
  size = 'md',
  className = '',
}: AvatarProps) {
  const [hasError, setHasError] = useState(false);

  const initials = name
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() || 'U';

  const sizeClass = SIZE_MAP[size] || SIZE_MAP.md;

  if (src && !hasError) {
    return (
      <div
        className={`relative overflow-hidden bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/30 shrink-0 shadow-sm flex items-center justify-center ${sizeClass} ${className}`}
      >
        <img
          src={src}
          alt={name}
          onError={() => setHasError(true)}
          className="w-full h-full object-cover select-none"
          loading="lazy"
        />
      </div>
    );
  }

  // Fallback initial badge with high-contrast Stitch styling
  return (
    <div
      className={`shrink-0 flex items-center justify-center font-heading font-bold text-[var(--primary)] dark:text-[var(--primary-fixed-dim)] bg-[var(--surface-container-high)] border border-[var(--outline-variant)]/20 shadow-inner select-none ${sizeClass} ${className}`}
      title={name}
    >
      {initials}
    </div>
  );
}
