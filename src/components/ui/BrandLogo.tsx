'use client';

import React from 'react';
import Link from 'next/link';

export type LogoVariant = 'monolith' | 'kinetic';

interface BrandIconProps {
  size?: number | string;
  variant?: LogoVariant;
  className?: string;
}

/**
 * Modern vector emblem for DebtSync inspired by clean fintech marks (Revolut, Wise).
 * Default: The Solid Monolith — A vibrant gradient squircle with a geometric negative-space
 * 'D' cutout and a precision diagonal synchronization slice.
 */
export function BrandIcon({ size = 40, variant = 'monolith', className = '' }: BrandIconProps) {
  if (variant === 'kinetic') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <rect x="6" y="6" width="6.5" height="28" rx="3.25" fill="currentColor" className="text-[var(--primary)]" />
        <path
          d="M12.5 6H24C30.6274 6 36 11.3726 36 18C36 20.3 35.3 22.4 34.1 24.2L26.5 16.6C26.1 14.5 24.4 12.8 22.3 12.8H12.5V6Z"
          fill="currentColor"
          className="text-[var(--primary)]"
        />
        <path
          d="M12.5 34H24C30.6274 34 36 28.6274 36 22C36 21.2 35.9 20.4 35.7 19.6L28.1 27.2C27.1 27.8 25.6 28.2 24 28.2H12.5V34Z"
          fill="currentColor"
          className="text-[var(--primary-fixed-dim)] dark:text-[#2ec4c4]"
        />
        <circle cx="21" cy="20" r="2" fill="currentColor" className="text-[var(--primary)]" opacity="0.9" />
      </svg>
    );
  }

  // Default: 'monolith' (The Solid Monolith)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="monolith-grad" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--primary-container)" />
        </linearGradient>
      </defs>
      {/* Vibrant Squircle Monolith Base */}
      <rect width="40" height="40" rx="10.5" fill="url(#monolith-grad)" />
      <rect x="0.5" y="0.5" width="39" height="39" rx="10" stroke="var(--primary)" strokeOpacity="0.3" />

      {/* Negative Space Geometric 'D' Cutout */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11 9C9.89543 9 9 9.89543 9 11V29C9 30.1046 9.89543 31 11 31H22.5C28.299 31 33 26.299 33 20.5C33 14.701 28.299 9 22.5 9H11ZM14.5 14H22C25.5899 14 28.5 16.9101 28.5 20.5C28.5 24.0899 25.5899 27 22 27H14.5V14Z"
        fill="var(--on-primary)"
      />

      {/* Precision Diagonal Sync Slice */}
      <rect
        x="21.5"
        y="10.5"
        width="3"
        height="19"
        rx="1.5"
        transform="rotate(33 21.5 10.5)"
        fill="url(#monolith-grad)"
      />
    </svg>
  );
}

export interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: LogoVariant;
  showWordmark?: boolean;
  showTagline?: boolean;
  tagline?: string;
  href?: string;
  className?: string;
}

export const DEFAULT_TAGLINE = 'Synced Ledgers. Zero Friction.';

export function BrandLogo({
  size = 'md',
  variant = 'monolith',
  showWordmark = true,
  showTagline = true,
  tagline = DEFAULT_TAGLINE,
  href,
  className = '',
}: BrandLogoProps) {
  const sizeConfig = {
    sm: { iconSize: 32, textSize: 'text-base', tagSize: 'text-[9px]' },
    md: { iconSize: 40, textSize: 'text-lg', tagSize: 'text-[10px]' },
    lg: { iconSize: 48, textSize: 'text-2xl', tagSize: 'text-[11px]' },
    xl: { iconSize: 56, textSize: 'text-3xl', tagSize: 'text-xs' },
  }[size];

  const content = (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      {/* Icon Badge Container */}
      <div className="shrink-0 transition-transform group-hover:scale-105 shadow-sm rounded-xl overflow-hidden flex items-center justify-center">
        <BrandIcon size={sizeConfig.iconSize} variant={variant} />
      </div>

      {/* Wordmark and Tagline */}
      {showWordmark && (
        <div className="min-w-0 flex flex-col justify-center">
          <div className={`font-heading ${sizeConfig.textSize} font-extrabold tracking-tight text-[var(--on-surface)] leading-none flex items-center`}>
            <span>Debt</span>
            <span className="text-[var(--primary)] dark:text-[var(--primary-fixed-dim)]">Sync</span>
          </div>

          {showTagline && (
            <div className={`font-mono ${sizeConfig.tagSize} text-[var(--on-surface-variant)] tracking-wider uppercase font-semibold mt-1 truncate`}>
              {tagline}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="group inline-flex items-center cursor-pointer focus:outline-none">
        {content}
      </Link>
    );
  }

  return content;
}
