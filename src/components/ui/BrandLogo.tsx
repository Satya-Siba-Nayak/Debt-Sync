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
 * Default: The Solid Monolith — A radiant gradient squircle with a crisp, high-contrast
 * white geometric 'D' with precision synchronization counter-flow arcs and center node.
 * 100% vector-pure, high visibility in light and dark themes on both mobile and desktop.
 */
export function BrandIcon({ size = 40, variant = 'monolith', className = '' }: BrandIconProps) {
  const numericSize = typeof size === 'number' ? size : parseInt(String(size), 10) || 40;

  return (
    <div
      className={`inline-flex items-center justify-center shrink-0 rounded-[26%] shadow-sm overflow-hidden select-none ${className}`}
      style={{
        width: numericSize,
        height: numericSize,
        background: 'linear-gradient(135deg, #00F0FF 0%, #00757F 100%)',
        boxShadow: '0 2px 8px rgba(0, 240, 255, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.28)',
      }}
      aria-hidden="true"
    >
      <svg
        width={Math.round(numericSize * 0.65)}
        height={Math.round(numericSize * 0.65)}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        {/* Vertical Ledger Spine */}
        <rect x="2" y="2" width="3.5" height="20" rx="1.75" fill="#FFFFFF" />
        {/* Upper Synchronization Arc */}
        <path
          d="M8 2H13C17.4183 2 21 5.58172 21 10C21 11.4 20.6 12.7 19.9 13.8L15.6 9.5C15.3 7.8 13.8 6.5 12 6.5H8V2Z"
          fill="#FFFFFF"
        />
        {/* Lower Return Arc */}
        <path
          d="M8 22H13C17.4183 22 21 18.4183 21 14C21 13.6 20.9 13.2 20.8 12.8L16.5 17.1C15.5 18 14 18.5 12.5 18.5H8V22Z"
          fill="#FFFFFF"
          opacity="0.95"
        />
        {/* Center Synchronized Node */}
        <circle cx="11.5" cy="12" r="1.75" fill="#FFFFFF" />
      </svg>
    </div>
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
