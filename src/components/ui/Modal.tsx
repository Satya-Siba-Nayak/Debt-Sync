'use client';

import React, { useEffect } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-xl',
}: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto overscroll-contain modal-scroll-container">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full ${maxWidth} bg-[var(--surface-container-lowest)] rounded-t-3xl sm:rounded-2xl border-t sm:border border-[var(--outline-variant)]/40 shadow-2xl p-4 sm:p-8 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:pb-8 z-10 max-h-[92dvh] sm:max-h-[88vh] overflow-y-auto overscroll-contain modal-scroll-container sm:my-8 transition-all`}
        role="dialog"
        aria-modal="true"
      >
        {/* Mobile Pull Handle Pill */}
        <div className="w-12 h-1.5 rounded-full bg-[var(--outline-variant)]/50 mx-auto mb-3.5 sm:hidden" />

        <div className="flex items-start justify-between pb-3.5 border-b border-[var(--outline-variant)]/20 mb-4 sm:mb-5">
          <div className="pr-2">
            <h2 className="text-lg sm:text-xl font-heading font-bold text-[var(--on-surface)] leading-snug">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs sm:text-sm text-[var(--on-surface-variant)] mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-xl bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] flex items-center justify-center transition-all cursor-pointer active:scale-90"
            aria-label="Close dialog"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="relative">{children}</div>
      </div>
    </div>
  );
}
