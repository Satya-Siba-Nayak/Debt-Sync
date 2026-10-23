import React from 'react';
import Link from 'next/link';
import { PublicNav } from '@/components/layout/PublicNav';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { ContactForm } from '@/components/public/ContactForm';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact & Support • DebtSync',
  description: 'Get in touch with DebtSync support, report bugs, ask questions, or request account data deletion.',
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--on-surface)] flex flex-col selection:bg-[var(--primary)] selection:text-[var(--on-primary)] transition-colors">
      <PublicNav currentPath="/contact" />

      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        {/* Header */}
        <div className="border-b border-[var(--outline-variant)]/30 pb-8 mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30 mb-4">
            <span className="material-symbols-outlined text-[13px]">contact_support</span>
            <span>Help &amp; Inquiries</span>
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-extrabold text-[var(--on-surface)] tracking-tight">
            Contact &amp; Support
          </h1>
          <p className="mt-3 font-mono text-xs sm:text-sm text-[var(--on-surface-variant)] leading-relaxed">
            Have a question, feedback, or need help with a transaction? We&apos;re here to assist.
          </p>
        </div>

        {/* Channels Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {/* Card 1: Technical & Account Support */}
          <div className="p-6 rounded-2xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">support_agent</span>
            </div>
            <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
              Technical &amp; Account Support
            </h3>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] leading-relaxed">
              For questions regarding account login, agreement verification, bug reports, or account and data deletion requests.
            </p>
            <div className="pt-2">
              <a
                href="mailto:support@satya-nayak.dev"
                className="inline-flex items-center gap-2 font-mono text-xs font-bold text-[var(--primary)] hover:underline"
              >
                <span className="material-symbols-outlined text-[16px]">mail</span>
                <span>support@satya-nayak.dev</span>
              </a>
            </div>
          </div>

          {/* Card 2: General Inquiries & Partnerships */}
          <div className="p-6 rounded-2xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">chat</span>
            </div>
            <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
              General Inquiries &amp; Feedback
            </h3>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] leading-relaxed">
              For general questions, open-source collaboration, feature ideas, or API and gateway integration discussions.
            </p>
            <div className="pt-2">
              <a
                href="mailto:contact@satya-nayak.dev"
                className="inline-flex items-center gap-2 font-mono text-xs font-bold text-[var(--primary)] hover:underline"
              >
                <span className="material-symbols-outlined text-[16px]">alternate_email</span>
                <span>contact@satya-nayak.dev</span>
              </a>
            </div>
          </div>

          {/* Card 3: GitHub Issues */}
          <div className="p-6 rounded-2xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">bug_report</span>
            </div>
            <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
              Open-Source Issue Tracker
            </h3>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] leading-relaxed">
              Track bugs, submit pull requests, or browse public development discussions on our open GitHub repository.
            </p>
            <div className="pt-2">
              <a
                href="https://github.com/Satya-Siba-Nayak/Debt-Sync/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-mono text-xs font-bold text-[var(--primary)] hover:underline"
              >
                <span>github.com/Satya-Siba-Nayak/Debt-Sync/issues</span>
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
              </a>
            </div>
          </div>

          {/* Card 4: Built-in In-App Reporter */}
          <div className="p-6 rounded-2xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">send</span>
            </div>
            <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
              In-App Bug &amp; Feedback Reporter
            </h3>
            <p className="font-mono text-xs text-[var(--on-surface-variant)] leading-relaxed">
              Already logged in? You can report issues directly from any page via the &quot;Report Issue&quot; option in your account menu, which auto-attaches diagnostic logs.
            </p>
            <div className="pt-2">
              <Link
                href="/dash"
                className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-[var(--primary)] hover:underline"
              >
                <span>Open Dashboard</span>
                <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Interactive Contact & Regulatory Inquiries Form */}
        <div className="mb-14">
          <ContactForm />
        </div>

        {/* Quick Help & FAQ Reference */}
        <div className="space-y-4 font-mono text-xs border-t border-[var(--outline-variant)]/30 pt-10">
          <h2 className="font-heading text-xl font-bold text-[var(--on-surface)] mb-4">
            Common Inquiries
          </h2>

          <div className="p-4 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/20 space-y-1.5">
            <h4 className="font-heading font-bold text-xs text-[var(--on-surface)]">
              How do I delete my account or personal records?
            </h4>
            <p className="text-[var(--on-surface-variant)] leading-relaxed">
              Send an email from your registered address to <a href="mailto:support@satya-nayak.dev" className="text-[var(--primary)] underline font-bold">support@satya-nayak.dev</a> with the subject &quot;Account Deletion&quot;. All profile information and records will be permanently erased within 48 hours.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/20 space-y-1.5">
            <h4 className="font-heading font-bold text-xs text-[var(--on-surface)]">
              How do I cancel a pending transaction proposal?
            </h4>
            <p className="text-[var(--on-surface-variant)] leading-relaxed">
              Open the transaction detail in your dashboard and tap &quot;Take Back&quot;. This immediately cancels and removes the pending agreement before the counterparty accepts.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/20 space-y-1.5">
            <h4 className="font-heading font-bold text-xs text-[var(--on-surface)]">
              How does the live public share link work?
            </h4>
            <p className="text-[var(--on-surface-variant)] leading-relaxed">
              Public links allow anyone to view a read-only receipt of the debt without creating an account. Email addresses are strictly masked (e.g. <span className="text-[var(--primary)]">s***k@domain.com</span>) and private notes are hidden. Either participant can revoke the public link at any time from the agreement details modal.
            </p>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
