import React from 'react';
import Link from 'next/link';
import { PublicNav } from '@/components/layout/PublicNav';
import { PublicFooter } from '@/components/layout/PublicFooter';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy • DebtSync',
  description: 'DebtSync privacy policy, data collection practices, India DPDP Act compliance, and user rights.',
};

export default function PrivacyPolicyPage() {
  const lastUpdated = 'October 23, 2026';

  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--on-surface)] flex flex-col selection:bg-[var(--primary)] selection:text-[var(--on-primary)] transition-colors">
      <PublicNav currentPath="/privacy" />

      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        {/* Header */}
        <div className="border-b border-[var(--outline-variant)]/30 pb-8 mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 mb-4">
            <span className="material-symbols-outlined text-[13px]">shield</span>
            <span>Privacy &amp; Data Protection</span>
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-extrabold text-[var(--on-surface)] tracking-tight">
            Privacy Policy
          </h1>
          <p className="mt-3 font-mono text-xs text-[var(--on-surface-variant)]">
            Effective Date: {lastUpdated} • Applicable to DebtSync (debt-sync.satya-nayak.dev)
          </p>
        </div>

        {/* Content Body */}
        <div className="space-y-10 font-mono text-xs sm:text-sm text-[var(--on-surface-variant)] leading-relaxed">
          {/* Section 1: Introduction */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              1. Introduction &amp; Core Philosophy
            </h2>
            <p>
              DebtSync (&quot;we&quot;, &quot;our&quot;, or &quot;the platform&quot;) is an open-source collaborative peer-to-peer ledger, interest calculation tool, and debt management portal accessible at{' '}
              <a href="https://debt-sync.satya-nayak.dev" className="text-[var(--primary)] underline">
                https://debt-sync.satya-nayak.dev
              </a>.
            </p>
            <p>
              We believe financial record-keeping should be transparent between agreeing parties and invisible to everyone else. We do not sell your personal data, we do not run third-party advertising trackers, and we minimize data collection strictly to what is required to maintain your shared ledgers and dispatch requested notifications.
            </p>
          </section>

          {/* Section 2: Information We Collect */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              2. Information We Collect
            </h2>
            <p>When you use DebtSync, we collect the following categories of information:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-[var(--on-surface)]">Account Credentials &amp; Profile:</strong> Your email address, display name, profile avatar, and (where phone authentication or OTP verification is enabled) your mobile phone number.
              </li>
              <li>
                <strong className="text-[var(--on-surface)]">Transaction &amp; Ledger Records:</strong> Transaction principal amounts, selected currency (e.g. INR, USD), interest engine parameters (Simple or Compounding APR), transaction dates, due dates, settlement status, and two-sided personal notes recorded between lender and borrower.
              </li>
              <li>
                <strong className="text-[var(--on-surface)]">Repayment Receipts:</strong> Recorded repayment amounts, timestamps, lender verification states, dispute records, and optional payment method tags (UPI, Cash, Bank Transfer, or transaction reference identifiers).
              </li>
              <li>
                <strong className="text-[var(--on-surface)]">Notification &amp; Device Tokens:</strong> Web Push subscription endpoints and notification preference toggles stored to deliver transaction alerts, reminder dispatches, and due date alerts.
              </li>
            </ul>
          </section>

          {/* Section 3: How We Use Your Data */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              3. Purpose &amp; Legal Basis of Processing
            </h2>
            <p>We process your data strictly to provide and maintain the core functionality of DebtSync:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Facilitating two-sided peer transaction consensus and repayment tracking between you and your invited counterparties.</li>
              <li>Performing real-time mathematical interest accrual calculations according to your selected APR rules.</li>
              <li>Dispatching agreement invitations, payment verification alerts, friendly lender reminders, and 1-day due date notifications.</li>
              <li>Enforcing security rate limits (such as preventing OTP flooding or reminder spamming) and safeguarding against abusive platform behavior.</li>
            </ul>
          </section>

          {/* Section 4: Dual Sharing Privacy System */}
          <section className="space-y-3 p-5 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30">
            <h2 className="font-heading text-lg font-bold text-[var(--on-surface)] flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-[var(--primary)]">share</span>
              <span>4. Dual Sharing System Privacy Guarantees</span>
            </h2>
            <p>DebtSync provides two distinct link-sharing mechanisms, each with explicit privacy safeguards:</p>
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                <strong className="text-[var(--on-surface)]">Participants-Only Link:</strong> Restricted strictly to authenticated members of the transaction (lender, borrower, or split group participants). Unauthenticated visitors are blocked by a cryptographic verification gate.
              </li>
              <li>
                <strong className="text-[var(--on-surface)]">Global Public Link:</strong> Generates a read-only token viewable by external parties without an account. On this link, email addresses are strictly masked (e.g. <span className="text-[var(--primary)]">s***k@domain.com</span>), and creator/counterparty private notes are completely withheld. Either participant can revoke the public link at any time.
              </li>
            </ol>
          </section>

          {/* Section 5: Third-Party Infrastructure */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              5. Service Providers &amp; Infrastructure
            </h2>
            <p>To operate securely, we utilize established infrastructure providers who adhere to strict data processing standards:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-[var(--on-surface)]">Supabase Inc.:</strong> Cloud database (PostgreSQL), user authentication, Row-Level Security (RLS) enforcement, and Edge Function orchestration.
              </li>
              <li>
                <strong className="text-[var(--on-surface)]">Brevo (formerly Sendinblue):</strong> Transactional email delivery for account signups, agreement notifications, and payment reminders.
              </li>
              <li>
                <strong className="text-[var(--on-surface)]">Messaging Gateways (Fast2SMS / Meta):</strong> SMS, RCS, or WhatsApp message delivery strictly for user-requested phone number authentication and OTP verification.
              </li>
              <li>
                <strong className="text-[var(--on-surface)]">Cloudflare / Vercel:</strong> DNS, SSL/TLS termination, DDoS mitigation, and global edge content delivery.
              </li>
            </ul>
          </section>

          {/* Section 6: India DPDP Act Compliance */}
          <section id="dpdp" className="space-y-3 p-5 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30">
            <h2 className="font-heading text-lg font-bold text-[var(--on-surface)] flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-emerald-500">gavel</span>
              <span>6. India Digital Personal Data Protection (DPDP) Act Compliance</span>
            </h2>
            <p>
              For users in India, we process personal data in compliance with the Digital Personal Data Protection (DPDP) Act, 2023:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-[var(--on-surface)]">Consent &amp; Specific Purpose:</strong> Personal data is processed solely with your explicit consent and strictly for peer ledger management and communications.
              </li>
              <li>
                <strong className="text-[var(--on-surface)]">Right to Information &amp; Access:</strong> You can view all agreements, transactions, and counterparties associated with your account directly in your dashboard.
              </li>
              <li>
                <strong className="text-[var(--on-surface)]">Right to Correction &amp; Erasure:</strong> You retain the absolute right to edit, cancel, or permanently delete personal records and account credentials.
              </li>
              <li>
                <strong className="text-[var(--on-surface)]">Grievance Redressal:</strong> Inquiries or grievances can be addressed to our designated Data Protection &amp; Support contact at <a href="mailto:support@satya-nayak.dev" className="text-[var(--primary)] underline font-bold">support@satya-nayak.dev</a>.
              </li>
            </ul>
          </section>

          {/* Section 7: Data Retention & Deletion */}
          <section id="data-deletion" className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              7. Data Retention &amp; Account Deletion
            </h2>
            <p>
              Your transaction records are retained for as long as your account remains active or until you choose to delete them. You can take back or cancel pending agreements directly from the UI.
            </p>
            <p>
              To request complete deletion of your account, authentication credentials, and all associated personal records, simply send an email from your registered address to{' '}
              <a href="mailto:support@satya-nayak.dev" className="text-[var(--primary)] underline font-bold">
                support@satya-nayak.dev
              </a>{' '}
              with the subject &quot;Account Deletion Request&quot;. Deletion requests are permanently processed within 48 hours.
            </p>
          </section>

          {/* Section 8: Security Measures */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              8. Security Safeguards
            </h2>
            <p>
              We implement industry-standard safeguards including PostgreSQL Row-Level Security (RLS) policies ensuring users cannot query or modify unauthorized ledgers, 256-bit TLS encryption in transit, cryptographic password hashing, strict API rate-limiting, and sanitized inputs preventing injection vulnerabilities.
            </p>
          </section>

          {/* Section 9: Open Source Transparency */}
          <section className="space-y-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              9. Open Source Transparency
            </h2>
            <p>
              DebtSync is an open-source project. Our full codebase, database schemas, and notification pipelines are publicly auditable at{' '}
              <a
                href="https://github.com/Satya-Siba-Nayak/Debt-Sync"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] underline"
              >
                https://github.com/Satya-Siba-Nayak/Debt-Sync
              </a>.
            </p>
          </section>

          {/* Section 10: Contact Us */}
          <section className="space-y-3 border-t border-[var(--outline-variant)]/30 pt-6">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)]">
              10. Contact &amp; Questions
            </h2>
            <p>
              If you have any questions, concerns, or requests regarding this Privacy Policy, please reach out to us:
            </p>
            <div className="p-4 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 space-y-1.5">
              <p>
                <strong>Support Contact:</strong>{' '}
                <a href="mailto:support@satya-nayak.dev" className="text-[var(--primary)] underline">
                  support@satya-nayak.dev
                </a>
              </p>
              <p>
                <strong>General Inquiries:</strong>{' '}
                <a href="mailto:contact@satya-nayak.dev" className="text-[var(--primary)] underline">
                  contact@satya-nayak.dev
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
