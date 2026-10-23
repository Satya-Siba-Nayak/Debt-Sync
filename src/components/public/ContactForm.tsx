'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_DAILY_INQUIRIES = 2; // Strict 2 per day
const DEFAULT_DISCORD_WEBHOOK =
  'https://discord.com/api/webhooks/1558604580080586932/j9kPe21iWJaDvVWm_BDlY0q8Xxkxp60DVfNIg94bjUjHRPYS2YolpYtim_2-qfdZH-cz';

function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('debtsync_contact_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
    try {
      localStorage.setItem('debtsync_contact_device_id', id);
    } catch (_) {}
  }
  return id;
}

function getRecentSubmissionTimestamps(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('debtsync_contact_inquiries');
    if (!raw) return [];
    const timestamps: number[] = JSON.parse(raw);
    const now = Date.now();
    return timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  } catch (_) {
    return [];
  }
}

function recordSubmissionTimestamp(): void {
  if (typeof window === 'undefined') return;
  try {
    const recent = getRecentSubmissionTimestamps();
    recent.push(Date.now());
    localStorage.setItem('debtsync_contact_inquiries', JSON.stringify(recent));
  } catch (_) {}
}

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
  const [inquiriesToday, setInquiriesToday] = useState(0);

  useEffect(() => {
    const recent = getRecentSubmissionTimestamps();
    setInquiriesToday(recent.length);
  }, []);

  const remainingDaily = Math.max(0, MAX_DAILY_INQUIRIES - inquiriesToday);
  const isDailyLimitReached = remainingDaily === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isDailyLimitReached) {
      setError('Daily limit reached: You can submit at most 2 inquiries per day from this device.');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setError('Please provide a valid email address so we can reply.');
      return;
    }

    if (!message.trim()) {
      setError('Please enter your message.');
      return;
    }

    if (!optInCommunications) {
      setError('Please check the communication consent box to submit your inquiry.');
      return;
    }

    setSubmitting(true);

    try {
      const deviceId = getOrCreateDeviceId();
      let isDelivered = false;

      const payload = {
        fullName: fullName.trim() || undefined,
        email: email.trim(),
        phone: phone.trim() || undefined,
        category,
        message: message.trim(),
        optInCommunications,
      };

      // 1. Try server endpoint first (works if backend/node runtime is active)
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-device-id': deviceId,
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          isDelivered = true;
        } else if (res.status === 429) {
          let errorMsg = 'Daily limit reached: Maximum 2 inquiries per 24 hours from this device.';
          try {
            const text = await res.text();
            const d = text ? JSON.parse(text) : {};
            if (d.error) errorMsg = d.error;
          } catch (_) {}
          throw new Error(errorMsg);
        }
      } catch (srvErr: any) {
        if (srvErr.message?.includes('Daily limit reached')) {
          throw srvErr;
        }
        // Fall through to direct Discord webhook fallback on static export
      }

      // 2. Direct Discord webhook dispatch (for static exports where /api routes do not exist)
      if (!isDelivered) {
        const webhookUrl =
          process.env.NEXT_PUBLIC_DISCORD_CONTACT_WEBHOOK_URL ||
          process.env.NEXT_PUBLIC_DISCORD_BUG_WEBHOOK_URL ||
          DEFAULT_DISCORD_WEBHOOK;

        const categoryLabels: Record<string, string> = {
          support: '🛠️ Technical & Account Support',
          deletion: '🗑️ Account & Data Deletion Request',
          rcs_sms: '📡 Telecom / Carrier / RCS Inquiry',
          general: '💬 General Feedback & Partnerships',
        };
        const categoryLabel = categoryLabels[category] || 'General Inquiry';

        const embed = {
          title: `📬 Public Contact Inquiry: ${categoryLabel}`,
          color: 0x00a896, // DebtSync Teal
          fields: [
            {
              name: '👤 Inquirer',
              value: `**${fullName.trim() || 'Website Visitor'}**\n📧 \`${email.trim()}\``,
              inline: true,
            },
            {
              name: '📱 Phone',
              value: phone.trim() ? `\`${phone.trim()}\`` : '_Not Provided (Email Only)_',
              inline: true,
            },
            {
              name: '🏷️ Category',
              value: categoryLabel,
              inline: false,
            },
            {
              name: '💬 Inquiry Message',
              value: message.trim().length > 1800 ? message.trim().slice(0, 1800) + '...' : message.trim(),
              inline: false,
            },
            {
              name: '📜 Telecom / Operator Consent',
              value: '✅ Consented to communications via SMS, RCS, WhatsApp & Email for service receipts & reminders.',
              inline: false,
            },
          ],
          footer: {
            text: `DebtSync Contact • 2/day device limit • ${new Date().toISOString()}`,
          },
          timestamp: new Date().toISOString(),
        };

        const discordRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed] }),
        });

        // Discord webhook returns 204 No Content on success (empty body)
        if (!discordRes.ok) {
          throw new Error(`Discord delivery returned status ${discordRes.status}. Please try again later.`);
        }
        isDelivered = true;
      }

      recordSubmissionTimestamp();
      setInquiriesToday((prev) => prev + 1);
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
          Inquiry Successfully Dispatched to Discord
        </h3>
        <p className="text-xs text-[var(--on-surface-variant)] max-w-md mx-auto leading-relaxed">
          Thank you{fullName ? `, ${fullName}` : ''}! Your message regarding{' '}
          <span className="text-[var(--primary)] font-bold">{category}</span> has been posted directly to our team Discord channel. We will reply to <strong>{email}</strong>.
        </p>
        <div className="text-[11px] text-[var(--on-surface-variant)]/70">
          Device daily submissions: {inquiriesToday}/{MAX_DAILY_INQUIRIES} used today.
        </div>
        <div className="pt-2">
          {remainingDaily > 0 ? (
            <button
              type="button"
              onClick={() => {
                setSubmitted(false);
                setMessage('');
              }}
              className="px-4 py-2 rounded-xl bg-[var(--surface-container-high)] text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] text-xs font-semibold border border-[var(--outline-variant)]/30 transition-colors cursor-pointer"
            >
              Send Another Inquiry ({remainingDaily} left today)
            </button>
          ) : (
            <span className="text-xs text-amber-500">
              Daily quota reached for this device (2/2).
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8 rounded-2xl bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/30 shadow-md">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--outline-variant)]/20 pb-4">
        <div>
          <h3 className="font-heading text-lg sm:text-xl font-bold text-[var(--on-surface)] flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-[var(--primary)]">outgoing_mail</span>
            <span>Send Us an Inquiry</span>
          </h3>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-0.5">
            Messages are routed directly to our developer team Discord.
          </p>
        </div>

        {/* Quota Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-[11px] bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 text-[var(--on-surface-variant)] self-start sm:self-center">
          <span className={`w-2 h-2 rounded-full ${isDailyLimitReached ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`} />
          <span>Device Quota: {remainingDaily}/{MAX_DAILY_INQUIRIES} left today</span>
        </div>
      </div>

      {isDailyLimitReached && (
        <div className="mb-5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-mono text-xs flex items-center gap-2.5">
          <span className="material-symbols-outlined text-[18px] shrink-0">hourglass_top</span>
          <span>
            Daily device limit reached (2 submissions per 24 hours). If your inquiry is urgent, please email{' '}
            <a href="mailto:support@satya-nayak.dev" className="underline font-bold">
              support@satya-nayak.dev
            </a>{' '}
            directly.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-bold mb-1.5">
              Full Name <span className="normal-case text-[10px] text-[var(--on-surface-variant)]/70">(optional)</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Alex Sharma"
              disabled={isDailyLimitReached}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none text-xs disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-bold mb-1.5">
              Email Address <span className="text-[var(--primary)]">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={isDailyLimitReached}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none text-xs disabled:opacity-50"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-bold mb-1.5">
              Mobile Phone <span className="normal-case text-[10px] text-[var(--on-surface-variant)]/70">(optional)</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210 (optional)"
              disabled={isDailyLimitReached}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none text-xs disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-bold mb-1.5">
              Inquiry Subject <span className="text-[var(--primary)]">*</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as any)}
              disabled={isDailyLimitReached}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none text-xs disabled:opacity-50"
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
            Message Details <span className="text-[var(--primary)]">*</span>
          </label>
          <textarea
            required
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={isDailyLimitReached}
            placeholder="Please describe your question or issue in detail..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none text-xs leading-relaxed disabled:opacity-50"
          />
        </div>

        {/* Carrier Consent Box */}
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
              disabled={isDailyLimitReached}
              className="mt-0.5 w-4 h-4 rounded border-outline-variant text-[var(--primary)] focus:ring-primary/20 accent-[var(--primary)] shrink-0 cursor-pointer disabled:opacity-50"
            />
            <div className="text-xs leading-relaxed min-w-0 text-[var(--on-surface)]">
              <span className="font-bold block text-[var(--on-surface)]">
                Carrier &amp; Communication Consent <span className="text-[var(--primary)]">*</span>
              </span>
              <span className="text-[11px] text-[var(--on-surface-variant)] block mt-1 leading-normal font-sans">
                By clicking Submit, I agree to receive communications from DebtSync via <strong>SMS</strong>, <strong>RCS</strong>, <strong>WhatsApp</strong>, and <strong>Email</strong> for service updates, transaction receipts, and verification reminders.
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
          disabled={submitting || isDailyLimitReached}
          className="w-full py-3 px-5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-bold text-xs hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 shadow-md cursor-pointer flex items-center justify-center gap-2 min-h-[44px]"
        >
          {submitting ? (
            <span>Sending to Discord...</span>
          ) : isDailyLimitReached ? (
            <span>Daily Limit Reached (2/2)</span>
          ) : (
            <>
              <span className="material-symbols-outlined text-[16px]">send</span>
              <span>Submit Inquiry ({remainingDaily}/2 left today)</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}
