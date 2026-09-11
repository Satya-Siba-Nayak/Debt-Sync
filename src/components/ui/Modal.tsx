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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full ${maxWidth} bg-[var(--surface-container-lowest)] rounded-t-3xl sm:rounded-2xl border-t sm:border border-[var(--outline-variant)]/40 shadow-2xl p-5 sm:p-8 z-10 max-h-[88vh] overflow-y-auto sm:my-8`}
        role="dialog"
        aria-modal="true"
      >
        {/* Mobile Pull Handle Pill */}
        <div className="w-10 h-1 rounded-full bg-[var(--outline-variant)]/60 mx-auto mb-4 sm:hidden" />

        <div className="flex items-start justify-between pb-3.5 border-b border-[var(--outline-variant)]/20 mb-5">
          <div>
            <h2 className="text-xl font-heading font-bold text-[var(--on-surface)]">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-[var(--on-surface-variant)] mt-1">
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container)] transition-colors"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div>{children}</div>
      </div>
    </div>
  );
}
