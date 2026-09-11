'use client';

import React, { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    // Check if already installed / standalone
    if (typeof window !== 'undefined') {
      const isStandaloneMode =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);

      const dismissed = sessionStorage.getItem('debtsync_pwa_prompt_dismissed');
      if (dismissed) setIsDismissed(true);

      // Check if iOS Safari
      const userAgent = window.navigator.userAgent.toLowerCase();
      const isApple = /iphone|ipad|ipod/.test(userAgent);
      setIsIOS(isApple);

      const handleBeforeInstallPrompt = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e as BeforeInstallPromptEvent);
      };

      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      };
    }
  }, []);

  if (isStandalone || isDismissed) return null;
  if (!deferredPrompt && !isIOS) return null;

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setIsStandalone(true);
      }
      setDeferredPrompt(null);
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem('debtsync_pwa_prompt_dismissed', 'true');
  };

  return (
    <>
      <div className="fixed bottom-20 md:bottom-6 right-4 left-4 md:left-auto md:w-96 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="bg-[var(--surface-container-lowest)] dark:bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/40 p-4 rounded-2xl shadow-xl backdrop-blur-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[var(--primary)] flex items-center justify-center text-[var(--on-primary)] font-bold text-sm shrink-0 shadow-sm">
              DS
            </div>
            <div className="min-w-0">
              <p className="font-heading font-bold text-xs text-[var(--on-surface)] truncate">
                Install DebtSync
              </p>
              <p className="font-mono text-[11px] text-[var(--on-surface-variant)] truncate">
                Add to home screen for 1-tap access
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleInstallClick}
              className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-xs"
            >
              Install
            </button>
            <button
              onClick={handleDismiss}
              className="p-1 rounded-lg text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] transition-colors"
              title="Dismiss"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>
      </div>

      {/* iOS Safari Guide Modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-4">
          <div className="bg-[var(--surface-container-lowest)] p-6 rounded-2xl max-w-sm w-full border border-[var(--outline-variant)]/30 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-heading font-bold text-base text-[var(--on-surface)]">
                Install on iPhone / iPad
              </h3>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="space-y-3 text-xs text-[var(--on-surface-variant)] font-body-md">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--surface-container)] flex items-center justify-center font-bold text-xs text-[var(--on-surface)]">
                  1
                </span>
                <span>
                  Tap the <strong className="text-[var(--on-surface)]">Share</strong> button at the bottom of Safari.
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--surface-container)] flex items-center justify-center font-bold text-xs text-[var(--on-surface)]">
                  2
                </span>
                <span>
                  Scroll down and select <strong className="text-[var(--on-surface)]">&quot;Add to Home Screen&quot;</strong>.
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--surface-container)] flex items-center justify-center font-bold text-xs text-[var(--on-surface)]">
                  3
                </span>
                <span>
                  Tap <strong className="text-[var(--on-surface)]">Add</strong> in the top right corner.
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-2 bg-[var(--primary)] text-[var(--on-primary)] rounded-xl font-mono text-xs font-bold hover:opacity-90"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
