'use client';

import React from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/ui/BrandLogo';

export function PublicFooter() {
  const [shouldKeepHomeQuery, setShouldKeepHomeQuery] = React.useState(false);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const hasHome =
        params.get('home') === 'true' ||
        params.get('stay') === 'true' ||
        params.get('preview') === 'true';
      const stored = sessionStorage.getItem('debtsync_viewing_public_site') === 'true';
      if (hasHome || stored) {
        setShouldKeepHomeQuery(true);
      }
    }
  }, []);

  const homeHref = shouldKeepHomeQuery ? '/?home=true' : '/';
  const privacyHref = shouldKeepHomeQuery ? '/privacy?home=true' : '/privacy';
  const termsHref = shouldKeepHomeQuery ? '/terms?home=true' : '/terms';
  const contactHref = shouldKeepHomeQuery ? '/contact?home=true' : '/contact';

  return (
    <footer className="border-t border-[var(--outline-variant)]/20 bg-[var(--surface-container-low)] text-[var(--on-surface-variant)] transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-12">
          {/* Brand Info & Mission */}
          <div className="md:col-span-1 space-y-4">
            <BrandLogo size="md" tagline="Synced Ledgers" href={homeHref} />
            <p className="text-xs font-mono leading-relaxed text-[var(--on-surface-variant)]">
              Privacy-first peer-to-peer ledger, interest calculation engine, and collaborative debt management portal. Keep transparent financial agreements with verified repayments and zero awkwardness.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Open Source • MIT</span>
              </span>
            </div>
          </div>

          {/* Product Links */}
          <div className="space-y-3 font-mono text-xs">
            <h4 className="font-heading font-bold text-sm text-[var(--on-surface)] tracking-wide">
              Product &amp; Features
            </h4>
            <ul className="space-y-2">
              <li>
                <Link href={shouldKeepHomeQuery ? '/?home=true#features' : '/#features'} className="hover:text-[var(--primary)] transition-colors">
                  Two-Sided Ledgers
                </Link>
              </li>
              <li>
                <Link href={shouldKeepHomeQuery ? '/?home=true#features' : '/#features'} className="hover:text-[var(--primary)] transition-colors">
                  APR Interest Engine
                </Link>
              </li>
              <li>
                <Link href={shouldKeepHomeQuery ? '/?home=true#features' : '/#features'} className="hover:text-[var(--primary)] transition-colors">
                  Payment Reminders (Email &amp; Push)
                </Link>
              </li>
              <li>
                <Link href={shouldKeepHomeQuery ? '/?home=true#live-demo' : '/#live-demo'} className="hover:text-[var(--primary)] transition-colors">
                  Dual Share System (Public &amp; Private)
                </Link>
              </li>
              <li>
                <Link href={shouldKeepHomeQuery ? '/?home=true#features' : '/#features'} className="hover:text-[var(--primary)] transition-colors">
                  Group Split Bills
                </Link>
              </li>
              <li>
                <Link href={shouldKeepHomeQuery ? '/?home=true#features' : '/#features'} className="hover:text-[var(--primary)] transition-colors">
                  Progressive Web App (PWA)
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal & Governance */}
          <div className="space-y-3 font-mono text-xs">
            <h4 className="font-heading font-bold text-sm text-[var(--on-surface)] tracking-wide">
              Trust &amp; Governance
            </h4>
            <ul className="space-y-2">
              <li>
                <Link href={privacyHref} className="hover:text-[var(--primary)] transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href={termsHref} className="hover:text-[var(--primary)] transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href={`${privacyHref}#dpdp`} className="hover:text-[var(--primary)] transition-colors">
                  DPDP Act (India) Compliance
                </Link>
              </li>
              <li>
                <Link href={`${privacyHref}#data-deletion`} className="hover:text-[var(--primary)] transition-colors">
                  Data Deletion &amp; Purge Requests
                </Link>
              </li>
              <li>
                <Link href={`${termsHref}#disclaimer`} className="hover:text-[var(--primary)] transition-colors">
                  Record-Keeping Disclaimer
                </Link>
              </li>
            </ul>
          </div>

          {/* Support & Community */}
          <div className="space-y-3 font-mono text-xs">
            <h4 className="font-heading font-bold text-sm text-[var(--on-surface)] tracking-wide">
              Support &amp; Community
            </h4>
            <ul className="space-y-2">
              <li>
                <Link href={contactHref} className="hover:text-[var(--primary)] transition-colors">
                  Contact Support
                </Link>
              </li>
              <li>
                <a
                  href="mailto:support@satya-nayak.dev"
                  className="hover:text-[var(--primary)] transition-colors flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[14px]">mail</span>
                  <span>support@satya-nayak.dev</span>
                </a>
              </li>
              <li>
                <a
                  href="mailto:contact@satya-nayak.dev"
                  className="hover:text-[var(--primary)] transition-colors flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[14px]">alternate_email</span>
                  <span>contact@satya-nayak.dev</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/Satya-Siba-Nayak/Debt-Sync"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[var(--primary)] transition-colors flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[14px]">code</span>
                  <span>GitHub Repository</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/Satya-Siba-Nayak/Debt-Sync/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[var(--primary)] transition-colors flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[14px]">bug_report</span>
                  <span>Report an Issue</span>
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar: Copyright & Developer Credits */}
        <div className="mt-12 pt-8 border-t border-[var(--outline-variant)]/20 flex flex-col md:flex-row items-center justify-between gap-4 font-mono text-xs">
          <div>
            <p className="text-[var(--on-surface-variant)]">
              &copy; {new Date().getFullYear()} DebtSync. Developed and maintained with care by{' '}
              <a
                href="https://github.com/Satya-Siba-Nayak"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] font-bold hover:underline"
              >
                Satya Siba Nayak
              </a>{' '}
              and{' '}
              <a
                href="https://github.com/jaiswalsneha7"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] font-bold hover:underline"
              >
                Sneha Jaiswal
              </a>.
            </p>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-[var(--on-surface-variant)]">
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
            <span>&bull;</span>
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
            <span>&bull;</span>
            <Link href="/contact" className="hover:underline">
              Contact
            </Link>
            <span>&bull;</span>
            <a
              href="https://debt-sync.satya-nayak.dev/share?id=81d9115e-d237-49eb-8be5-16bb3a9ea408&token=gsh_hitjra5bqn7dy2tsdf"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--primary)] hover:underline"
            >
              Sample Share Link
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
