'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { getCachedUserProfile, CachedProfile } from '@/lib/utils/auth-session';
import { createClient } from '@/lib/supabase/client';

interface PublicNavProps {
  currentPath?: string;
}

export function PublicNav({ currentPath }: PublicNavProps) {
  const [profile, setProfile] = useState<CachedProfile | null>(null);
  const [isHomeActive, setIsHomeActive] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    // 0ms cached profile check
    const cached = getCachedUserProfile();
    if (cached) setProfile(cached);

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const hasHome =
        params.get('home') === 'true' ||
        params.get('stay') === 'true' ||
        params.get('preview') === 'true';
      const stored = sessionStorage.getItem('debtsync_viewing_public_site') === 'true';
      if (hasHome || stored) {
        setIsHomeActive(true);
        try {
          sessionStorage.setItem('debtsync_viewing_public_site', 'true');
        } catch (_) {}
      }
    }

    // Verify session
    const supabase = createClient();
    supabase.auth.getSession().then((res: any) => {
      const session = res?.data?.session;
      if (session?.user) {
        setProfile({
          id: session.user.id,
          email: session.user.email,
          full_name: session.user.user_metadata?.full_name,
        });
      }
    });
  }, []);

  const shouldKeepHomeQuery = Boolean(profile || isHomeActive);
  const homeHref = shouldKeepHomeQuery ? '/?home=true' : '/';
  const privacyHref = shouldKeepHomeQuery ? '/privacy?home=true' : '/privacy';
  const termsHref = shouldKeepHomeQuery ? '/terms?home=true' : '/terms';
  const contactHref = shouldKeepHomeQuery ? '/contact?home=true' : '/contact';

  const clearPublicSession = () => {
    try {
      sessionStorage.removeItem('debtsync_viewing_public_site');
    } catch (_) {}
  };

  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-[var(--surface)]/85 border-b border-[var(--outline-variant)]/20 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo */}
        <div className="shrink-0 flex items-center">
          <BrandLogo size="sm" showTagline={false} href={homeHref} />
        </div>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 font-mono text-xs">
          <Link
            href={shouldKeepHomeQuery ? '/?home=true#features' : '/#features'}
            className="text-[var(--on-surface-variant)] hover:text-[var(--primary)] font-semibold transition-colors"
          >
            Features
          </Link>
          <Link
            href={shouldKeepHomeQuery ? '/?home=true#how-it-works' : '/#how-it-works'}
            className="text-[var(--on-surface-variant)] hover:text-[var(--primary)] font-semibold transition-colors"
          >
            How It Works
          </Link>
          <Link
            href={shouldKeepHomeQuery ? '/?home=true#live-demo' : '/#live-demo'}
            className="text-[var(--on-surface-variant)] hover:text-[var(--primary)] font-semibold transition-colors"
          >
            Live Demo
          </Link>
          <Link
            href={shouldKeepHomeQuery ? '/?home=true#screenshots' : '/#screenshots'}
            className="text-[var(--on-surface-variant)] hover:text-[var(--primary)] font-semibold transition-colors"
          >
            Previews
          </Link>
          <Link
            href={shouldKeepHomeQuery ? '/?home=true#faq' : '/#faq'}
            className="text-[var(--on-surface-variant)] hover:text-[var(--primary)] font-semibold transition-colors"
          >
            FAQ
          </Link>
          <a
            href="https://github.com/Satya-Siba-Nayak/Debt-Sync"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--on-surface-variant)] hover:text-[var(--primary)] font-semibold transition-colors flex items-center gap-1.5"
          >
            <span>GitHub</span>
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
          </a>
        </nav>

        {/* Right CTA Actions & Theme Toggle */}
        <div className="hidden sm:flex items-center gap-3">
          <ThemeToggle compact />

          {profile ? (
            <Link
              href="/dash"
              onClick={clearPublicSession}
              className="px-4 py-2 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 active:scale-95 transition-all shadow-sm flex items-center gap-1.5 min-h-[40px]"
            >
              <span>Go to Dashboard</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="px-3.5 py-2 rounded-xl font-mono text-xs font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container)] transition-colors min-h-[40px] flex items-center"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="px-4 py-2 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 active:scale-95 transition-all shadow-sm min-h-[40px] flex items-center gap-1.5"
              >
                <span>Get Started</span>
                <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
              </Link>
            </div>
          )}
        </div>

        {/* Mobile Hamburger Button */}
        <div className="flex items-center gap-2 sm:hidden">
          <ThemeToggle compact />
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--on-surface)] border border-[var(--outline-variant)]/30 hover:bg-[var(--surface-container)] transition-colors cursor-pointer"
            aria-label="Toggle navigation menu"
          >
            <span className="material-symbols-outlined text-[20px]">
              {isMobileMenuOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="sm:hidden border-t border-[var(--outline-variant)]/20 bg-[var(--surface)] px-4 pt-3 pb-6 space-y-3 font-mono text-xs">
          <div className="flex flex-col space-y-2">
            <Link
              href={shouldKeepHomeQuery ? '/?home=true#features' : '/#features'}
              onClick={() => setIsMobileMenuOpen(false)}
              className="py-2 px-3 rounded-lg text-[var(--on-surface)] hover:bg-[var(--surface-container)] font-semibold"
            >
              Features
            </Link>
            <Link
              href={shouldKeepHomeQuery ? '/?home=true#how-it-works' : '/#how-it-works'}
              onClick={() => setIsMobileMenuOpen(false)}
              className="py-2 px-3 rounded-lg text-[var(--on-surface)] hover:bg-[var(--surface-container)] font-semibold"
            >
              How It Works
            </Link>
            <Link
              href={shouldKeepHomeQuery ? '/?home=true#live-demo' : '/#live-demo'}
              onClick={() => setIsMobileMenuOpen(false)}
              className="py-2 px-3 rounded-lg text-[var(--on-surface)] hover:bg-[var(--surface-container)] font-semibold"
            >
              Live Demo
            </Link>
            <Link
              href={shouldKeepHomeQuery ? '/?home=true#screenshots' : '/#screenshots'}
              onClick={() => setIsMobileMenuOpen(false)}
              className="py-2 px-3 rounded-lg text-[var(--on-surface)] hover:bg-[var(--surface-container)] font-semibold"
            >
              App Previews
            </Link>
            <Link
              href={shouldKeepHomeQuery ? '/?home=true#faq' : '/#faq'}
              onClick={() => setIsMobileMenuOpen(false)}
              className="py-2 px-3 rounded-lg text-[var(--on-surface)] hover:bg-[var(--surface-container)] font-semibold"
            >
              FAQ
            </Link>
            <Link
              href={privacyHref}
              onClick={() => setIsMobileMenuOpen(false)}
              className="py-2 px-3 rounded-lg text-[var(--on-surface-variant)] hover:bg-[var(--surface-container)]"
            >
              Privacy Policy
            </Link>
            <Link
              href={termsHref}
              onClick={() => setIsMobileMenuOpen(false)}
              className="py-2 px-3 rounded-lg text-[var(--on-surface-variant)] hover:bg-[var(--surface-container)]"
            >
              Terms of Service
            </Link>
            <Link
              href={contactHref}
              onClick={() => setIsMobileMenuOpen(false)}
              className="py-2 px-3 rounded-lg text-[var(--on-surface-variant)] hover:bg-[var(--surface-container)]"
            >
              Contact &amp; Support
            </Link>
            <a
              href="https://github.com/Satya-Siba-Nayak/Debt-Sync"
              target="_blank"
              rel="noopener noreferrer"
              className="py-2 px-3 rounded-lg text-[var(--primary)] font-bold flex items-center justify-between"
            >
              <span>GitHub Repository</span>
              <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            </a>
          </div>

          <div className="pt-2 border-t border-[var(--outline-variant)]/20 flex flex-col gap-2">
            {profile ? (
              <Link
                href="/dash"
                onClick={() => {
                  clearPublicSession();
                  setIsMobileMenuOpen(false);
                }}
                className="w-full py-2.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-bold text-center flex items-center justify-center gap-1.5 min-h-[44px]"
              >
                <span>Open Dashboard</span>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="w-full py-2.5 rounded-xl border border-[var(--outline-variant)]/30 font-semibold text-center text-[var(--on-surface)] min-h-[44px] flex items-center justify-center"
                >
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="w-full py-2.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-bold text-center min-h-[44px] flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <span>Create Free Account</span>
                  <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
