import React from 'react';

export type ChipVariant = 'active' | 'pending' | 'overdue' | 'settled' | 'declined' | 'purged' | 'default';

interface ChipProps {
  label: string;
  variant?: ChipVariant;
  size?: 'sm' | 'md';
  icon?: string;
}

export function Chip({ label, variant = 'default', size = 'sm', icon }: ChipProps) {
  let colorClasses = 'bg-[var(--surface-container)] text-[var(--on-surface-variant)]';

  if (variant === 'active') {
    colorClasses = 'bg-[var(--secondary-container)] text-[var(--on-secondary-container)] border border-[var(--secondary)]/20';
  } else if (variant === 'pending') {
    colorClasses = 'bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] border border-[var(--outline-variant)]/40';
  } else if (variant === 'overdue') {
    colorClasses = 'bg-[var(--error-container)] text-[var(--on-error-container)] border border-[var(--error)]/30';
  } else if (variant === 'settled') {
    colorClasses = 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20';
  } else if (variant === 'declined') {
    colorClasses = 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30';
  } else if (variant === 'purged') {
    colorClasses = 'bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/40 font-bold';
  }

  const sizeClasses = size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  const displayLabel = label === 'purged' ? '(Transaction purged by admin)' : label;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-mono font-medium tracking-wide uppercase ${sizeClasses} ${colorClasses}`}
    >
      {icon && <span className="material-symbols-outlined text-[13px]">{icon}</span>}
      {displayLabel}
    </span>
  );
}
