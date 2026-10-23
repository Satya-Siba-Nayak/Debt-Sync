'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export function ContactForm() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState<'support' | 'deletion' | 'rcs_sms' | 'general'>('support');
  const [message, setMessage] = useState('');
  const [optInCommunications, setOptInCommunications] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!optInCommunications) {
      setError('Please check the communication consent box to submit your inquiry.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          category,
          message,
          optInCommunications,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit inquiry. Please try again.');
      }

      setSubmitting(false);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred while sending your inquiry.');
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="p-8 rounded-2xl bg-[var(--surface-container)] border border-emerald-500/40 text-center space-y-4 shadow-md font-mono">
        <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center mx-auto">
          <span className="material-symbols-outlined text-2xl">check_circle</span>
        </div>
        <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
          Inquiry Successfully Dispatched
        </h3>
        <p className="text-xs text-[var(--on-surface-variant)] max-w-md mx-auto leading-relaxed">
          Thank you, <strong>{fullName}</strong>. Your message regarding{' '}
          <span className="text-[var(--primary)] font-bold">{category}</span> has been routed to our technical support team. A confirmation has been logged for <strong>{email}</strong>.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => {
              setSubmitted(false);
              setMessage('');
            }}
            className="px-4 py-2 rounded-xl bg-[var(--surface-container-high)] text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] text-xs font-semibold border border-[var(--outline-variant)]/30 transition-colors cursor-pointer"
          >
            Send Another Inquiry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8 rounded-2xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 shadow-md">
      <div className="mb-6 space-y-1">
        <h3 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)] flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-[var(--primary)]">outgoing_mail</span>
          <span>Send Us an Inquiry</span>
        </h3>
        <p className="font-mono text-xs text-[var(--on-surface-variant)] leading-relaxed">
          Fill out this form for account assistance, carrier verification proof, or general questions.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-bold mb-1.5">
              Full Name *
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Alex Sharma"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-bold mb-1.5">
              Email Address *
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none text-xs"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-bold mb-1.5">
              Mobile Phone (with country code) *
            </label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-bold mb-1.5">
              Inquiry Subject *
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as any)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none text-xs"
            >
              <option value="support">Technical &amp; Account Support</option>
              <option value="deletion">Account &amp; Data Deletion Request</option>
              <option value="rcs_sms">Telecom / Carrier / RCS Inquiry</option>
              <option value="general">General Feedback &amp; Partnerships</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-bold mb-1.5">
            Message Details *
          </label>
          <textarea
            required
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Please describe your inquiry, transaction ID, or question in detail..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none text-xs leading-relaxed"
          />
        </div>

        {/* Mandatory Operator Consent Box */}
        <div className={`p-3.5 rounded-xl border transition-colors space-y-2 ${
          optInCommunications
            ? 'bg-[var(--surface-container)] border-[var(--primary)]/40'
            : 'bg-[var(--surface-container)] border-amber-500/30'
        }`}>
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              required
              checked={optInCommunications}
              onChange={(e) => setOptInCommunications(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-outline-variant text-[var(--primary)] focus:ring-primary/20 accent-[var(--primary)] shrink-0 cursor-pointer"
            />
            <div className="text-xs leading-relaxed min-w-0 text-[var(--on-surface)]">
              <span className="font-bold block text-[var(--on-surface)]">
                Carrier &amp; Communication Consent <span className="text-[var(--primary)]">*</span>
              </span>
              <span className="text-[11px] text-[var(--on-surface-variant)] block mt-1 leading-normal font-sans">
                By clicking Submit, I agree to receive communications from DebtSync via <strong>SMS</strong>, <strong>RCS</strong>, <strong>WhatsApp</strong>, and <strong>Email</strong> for inquiry follow-ups, transaction receipts, and payment verifications.
              </span>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block mt-1 font-mono">
                ✓ Inactive accounts will never receive spam or marketing. Reply STOP anytime to opt-out.
              </span>
            </div>
          </label>
          <div className="pt-1.5 border-t border-[var(--outline-variant)]/20 text-[10px] text-[var(--on-surface-variant)]">
            Review our{' '}
            <Link href="/terms" target="_blank" className="text-[var(--primary)] underline hover:opacity-80">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="text-[var(--primary)] underline hover:opacity-80">
              Privacy Policy
            </Link>
            .
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-xs font-mono">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 px-5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-bold text-xs hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 shadow-md cursor-pointer flex items-center justify-center gap-2 min-h-[44px]"
        >
          {submitting ? (
            <span>Sending Inquiry...</span>
          ) : (
            <>
              <span className="material-symbols-outlined text-[16px]">send</span>
              <span>Submit Inquiry</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}
