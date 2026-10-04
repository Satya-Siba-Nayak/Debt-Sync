'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  const [mounted, setMounted] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
      // Reset scroll position on open so it always starts at the top
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-hidden pointer-events-auto">
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Sheet */}
      <div
        className={`relative z-10 w-full ${maxWidth} bg-[var(--surface-container-lowest)] rounded-t-3xl sm:rounded-2xl border-t sm:border border-[var(--outline-variant)]/40 shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[88vh] overflow-hidden modal-animate-in sm:my-auto transition-all`}
        role="dialog"
        aria-modal="true"
      >
        {/* Fixed Header: Pull Handle (mobile) + Title + Subtitle + Close Button */}
        <div className="shrink-0 p-4 sm:p-6 pb-3 border-b border-[var(--outline-variant)]/20 bg-[var(--surface-container-lowest)]">
          {/* Mobile Pull Handle Pill */}
          <div className="w-12 h-1.5 rounded-full bg-[var(--outline-variant)]/50 mx-auto mb-3 sm:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 pr-2">
              <h2 className="text-base sm:text-xl font-heading font-bold text-[var(--on-surface)] leading-snug truncate">
                {title}
              </h2>
              {subtitle && (
                <p className="text-xs sm:text-sm text-[var(--on-surface-variant)] mt-0.5 line-clamp-2">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 shrink-0 rounded-xl bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] flex items-center justify-center transition-all cursor-pointer active:scale-90"
              aria-label="Close dialog"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto overscroll-contain modal-scroll-container p-4 sm:p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
