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
  { id: 'preset-1', label: 'Teal Minimal', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=DebtSync1' },
  { id: 'preset-2', label: 'Emerald Geometric', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=DebtSync2' },
  { id: 'preset-3', label: 'Slate Avatar', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=DebtSync3' },
  { id: 'preset-4', label: 'Cyan Cyber', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=DebtSync4' },
  { id: 'preset-5', label: 'Amber Shapes', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=DebtSync5' },
  { id: 'preset-6', label: 'Indigo Persona', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=DebtSync6' },
  { id: 'preset-7', label: 'Crimson Tech', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=DebtSync7' },
  { id: 'preset-8', label: 'Violet Mosaic', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=DebtSync8' },
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
