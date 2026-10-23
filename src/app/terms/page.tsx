import React from 'react';
import Link from 'next/link';
import { PublicNav } from '@/components/layout/PublicNav';
import { PublicFooter } from '@/components/layout/PublicFooter';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service • DebtSync',
  description: 'DebtSync terms of service, record-keeping disclaimers, acceptable use guidelines, and open-source licensing.',
};

export default function TermsOfServicePage() {
  const lastUpdated = 'October 23, 2026';

  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--on-surface)] flex flex-col selection:bg-[var(--primary)] selection:text-[var(--on-primary)] transition-colors">
      <PublicNav currentPath="/terms" />

      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        {/* Header */}
        <div className="border-b border-[var(--outline-variant)]/30 pb-8 mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-blue-500/15 text-blue-500 border border-blue-500/30 mb-4">
            <span className="material-symbols-outlined text-[13px]">contract</span>
            <span>Terms &amp; User Agreement</span>
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-extrabold text-[var(--on-surface)] tracking-tight">
            Terms of Service
          </h1>
          <p className="mt-3 font-mono text-xs text-[var(--on-surface-variant)]">
            Effective Date: {lastUpdated} • Applicable to DebtSync (debt-sync.satya-nayak.dev)
          </p>
        </div>

        {/* Content Body */}
        <div className="space-y-10 font-mono text-xs sm:text-sm text-[var(--on-surface-variant)] leading-relaxed">
          {/* Section 1: Agreement to Terms */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing or using DebtSync (&quot;the Service&quot;), hosted at{' '}
              <a href="https://debt-sync.satya-nayak.dev" className="text-[var(--primary)] underline">
                https://debt-sync.satya-nayak.dev
              </a>, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          {/* Section 2: Important Record-Keeping Disclaimer */}
          <section id="disclaimer" className="space-y-3 p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-[var(--on-surface)]">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold">
              <span className="material-symbols-outlined text-[20px]">warning</span>
              <h2 className="font-heading text-base sm:text-lg">
                2. Informational &amp; Ledger Tool Disclaimer (CRITICAL)
              </h2>
            </div>
            <p className="text-xs sm:text-sm leading-relaxed">
              <strong>DebtSync is an informational ledger, record-keeping portal, and mathematical calculation utility.</strong> DebtSync is <strong>NOT</strong> a bank, non-banking financial company (NBFC), money services business (MSB), money transmitter, lender, escrow service, credit bureau, or payment gateway.
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs leading-relaxed">
              <li>DebtSync does <strong>not</strong> hold, transmit, custody, deposit, or disburse real funds or fiat currency.</li>
              <li>DebtSync does <strong>not</strong> originate loans, broker credit, or act as an intermediary for financial transactions.</li>
              <li>All financial exchanges (via UPI, cash, bank transfer, etc.) occur entirely off-platform between the respective parties.</li>
              <li>DebtSync has no authority or obligation to enforce loan repayments, adjudicate debt disputes, or initiate debt collection proceedings.</li>
            </ul>
          </section>

          {/* Section 3: User Accounts & Eligibility */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              3. User Accounts &amp; Registration
            </h2>
            <p>
              To create an account and record agreements, you must provide a valid email address and (where required for authentication) a mobile phone number. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.
            </p>
          </section>

          {/* Section 4: Peer Agreements & Two-Sided Consensus */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              4. Peer Agreements &amp; Mutual Consensus
            </h2>
            <p>
              Agreements recorded on DebtSync are bilateral or multilateral mutual records between users:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>When a transaction is proposed, it remains in a <strong>Pending</strong> state until the designated counterparty reviews and accepts the terms.</li>
              <li>The creator of a pending agreement may edit terms or take back (cancel) the proposal prior to counterparty acceptance.</li>
              <li>Recorded repayments require lender verification. If a repayment receipt is contested, the platform flags it as <strong>Disputed</strong> to ensure mutual record accuracy.</li>
            </ul>
          </section>

          {/* Section 5: Interest Calculation Disclaimer */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              5. Interest Calculation Engine &amp; APR Accuracy
            </h2>
            <p>
              DebtSync provides mathematical calculations for Simple and Daily Compounding APR interest. These calculations are provided solely as mathematical estimations for mutual convenience.
            </p>
            <p>
              Users are solely responsible for ensuring that any peer loan agreements, interest charges, or repayment schedules comply with all applicable local, state, and national laws, including statutory interest rate ceilings (usury laws) and personal lending regulations.
            </p>
          </section>

          {/* Section 6: Acceptable Use Policy */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              6. Acceptable Use Policy
            </h2>
            <p>You agree not to misuse DebtSync. Specifically, you may not:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Abuse or spam notification mechanisms (email, push, or messaging) to harass any individual. Lender reminders are strictly capped by platform quotas.</li>
              <li>Create fraudulent agreements, impersonate another individual, or record debts without the counterparty&apos;s mutual awareness.</li>
              <li>Attempt to circumvent security measures, rate limits, Row-Level Security (RLS) policies, or authentication protocols.</li>
              <li>Use the platform for any illegal purpose, money laundering, extortion, or fraudulent scheme.</li>
            </ul>
          </section>

          {/* Section 7: Dual Sharing Terms */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              7. Dual Link Sharing Terms
            </h2>
            <p>
              When using the sharing features, you acknowledge that:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Participants-Only Links:</strong> Are restricted to verified participants. Attempting to share your personal session tokens is prohibited.
              </li>
              <li>
                <strong>Global Public Links:</strong> When enabled, anyone possessing the unique cryptographic link can view the transaction amounts and repayment receipts. While sensitive personal data is masked, you should only share public links with trusted parties. Either participant can revoke the public link at any time.
              </li>
            </ul>
          </section>

          {/* Section 8: Open Source License & Attribution */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              8. Open Source License (MIT) &amp; Intellectual Property
            </h2>
            <p>
              The DebtSync codebase is open-source software licensed under the{' '}
              <a
                href="https://github.com/Satya-Siba-Nayak/Debt-Sync/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] underline font-bold"
              >
                MIT License
              </a>. You are free to inspect, audit, and fork the code in accordance with the terms of the MIT license.
            </p>
          </section>

          {/* Section 9: Disclaimer of Warranties */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              9. Disclaimer of Warranties &amp; Limitation of Liability
            </h2>
            <p>
              THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. TO THE MAXIMUM EXTENT PERMITTED BY LAW, DEBTSYNC AND ITS MAINTAINERS DISCLAIM ALL WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
            <p>
              IN NO EVENT SHALL DEBTSYNC, ITS MAINTAINERS, CONTRIBUTORS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR FUNDS RESULTING FROM YOUR USE OF OR INABILITY TO USE THE SERVICE.
            </p>
          </section>

          {/* Section 10: Termination & Account Deletion */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              10. Termination
            </h2>
            <p>
              You may terminate your account at any time by requesting deletion via{' '}
              <a href="mailto:support@satya-nayak.dev" className="text-[var(--primary)] underline font-bold">
                support@satya-nayak.dev
              </a>. We reserve the right to suspend or terminate accounts that violate this Acceptable Use Policy or engage in abusive behavior.
            </p>
          </section>

          {/* Section 11: Contact */}
          <section className="space-y-3 border-t border-[var(--outline-variant)]/30 pt-6">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              11. Contact &amp; Questions
            </h2>
            <p>
              For questions regarding these Terms of Service, please contact us at:
            </p>
            <div className="p-4 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 space-y-1.5">
              <p>
                <strong>Support Contact:</strong>{' '}
                <a href="mailto:support@satya-nayak.dev" className="text-[var(--primary)] underline">
                  support@satya-nayak.dev
                </a>
              </p>
              <p>
                <strong>Project Maintainers:</strong> Satya Siba Nayak &amp; Sneha Jaiswal
              </p>
            </div>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
