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
 * The Solid Monolith: A vibrant cyan-teal gradient squircle with a crisp, geometric
 * 'D' silhouette and a precision 35° diagonal synchronization slice.
 * 100% vector-pure, high visibility in light and dark themes on both mobile and desktop.
 */
export function BrandIcon({ size = 40, className = '' }: BrandIconProps) {
  const numericSize = typeof size === 'number' ? size : parseInt(String(size), 10) || 40;

  return (
    <svg
      width={numericSize}
      height={numericSize}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 select-none ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="monolith-base-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00F0FF" />
          <stop offset="100%" stopColor="#00757F" />
        </linearGradient>
      </defs>
      {/* Vibrant Squircle Monolith Base */}
      <rect width="40" height="40" rx="10.5" fill="url(#monolith-base-grad)" />
      <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="9.75" stroke="#FFFFFF" strokeOpacity="0.25" strokeWidth="1.5" />

      {/* Geometric 'D' Monolith Silhouette */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.5 8.5C9.39543 8.5 8.5 9.39543 8.5 10.5V29.5C8.5 30.6046 9.39543 31.5 10.5 31.5H21C27.3513 31.5 32.5 26.3513 32.5 20C32.5 13.6487 27.3513 8.5 21 8.5H10.5ZM13.5 13.5H20.5C24.0899 13.5 27 16.4101 27 20C27 23.5899 24.0899 26.5 20.5 26.5H13.5V13.5Z"
        fill="#FFFFFF"
      />

      {/* Precision Diagonal Sync Slice */}
      <rect
        x="18.5"
        y="4"
        width="3.2"
        height="32"
        rx="1.6"
        transform="rotate(35 20 20)"
        fill="url(#monolith-base-grad)"
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

export const DEFAULT_TAGLINE = 'Synced Ledgers';

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
    sm: { iconSize: 32, textSize: 'text-base', tagSize: 'text-[9px]', maxTagWidth: 'max-w-[120px]' },
    md: { iconSize: 40, textSize: 'text-lg', tagSize: 'text-[10px]', maxTagWidth: 'max-w-[140px]' },
    lg: { iconSize: 48, textSize: 'text-2xl', tagSize: 'text-[11px]', maxTagWidth: 'max-w-[180px]' },
    xl: { iconSize: 56, textSize: 'text-3xl', tagSize: 'text-xs', maxTagWidth: 'max-w-[220px]' },
  }[size];

  const content = (
    <div className={`flex items-center gap-3 w-full max-w-full min-w-0 overflow-hidden ${className}`}>
      {/* Icon Badge Container */}
      <div className="shrink-0 transition-transform group-hover:scale-105 flex items-center justify-center">
        <BrandIcon size={sizeConfig.iconSize} variant={variant} />
      </div>

      {/* Wordmark and Tagline */}
      {showWordmark && (
        <div className="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
          <div className={`font-heading ${sizeConfig.textSize} font-extrabold tracking-tight text-[var(--on-surface)] leading-none flex items-center`}>
            <span>Debt</span>
            <span className="text-[#00c4b4] dark:text-[#38d9d9]">Sync</span>
          </div>

          {showTagline && (
            <div className={`font-mono ${sizeConfig.tagSize} text-[var(--on-surface-variant)] tracking-wider uppercase font-semibold mt-1 truncate ${sizeConfig.maxTagWidth}`}>
              {tagline}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="group inline-flex items-center cursor-pointer focus:outline-none min-w-0 max-w-full">
        {content}
      </Link>
    );
  }

  return content;
}
