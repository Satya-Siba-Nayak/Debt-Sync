'use client';

import { useState, Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { checkIdentifierConflict, checkPhoneRegistrationStatus } from '@/lib/utils/profile-lookup';
import { claimUserProfile, ClaimProfileOptions } from '@/lib/utils/claim-profile';
import { getRandomSampleName } from '@/lib/utils/random-placeholders';
import { checkAuthRateLimit } from '@/lib/utils/rate-limit';
import { ERROR_CODES, formatErrorWithCode, parseAuthError } from '@/lib/constants/error-codes';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { Modal } from '@/components/ui/Modal';
import { isSameEmail } from '@/lib/utils/email-normalize';

function maskEmailAddress(email?: string | null): string {
  if (!email || !email.includes('@')) return 'Protected Email';
  const [local, domain] = email.split('@');
  if (local.length <= 1) return `${local[0] || '*'}***@${domain}`;
  return `${local[0]}***${local.slice(-1)}@${domain}`;
}

function sanitizeRedirectDest(raw: string | null | undefined): string {
  if (!raw) return '/';
  let target = raw.trim();
  try {
    if (target.includes('%2F') || target.includes('%2f')) {
      target = decodeURIComponent(target);
    }
  } catch (_) {}

  if (target.startsWith('http://') || target.startsWith('https://')) {
    try {
      const parsed = new URL(target);
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
    } catch (_) {
      return '/';
    }
  }

  if (target.startsWith('/') && !target.startsWith('//')) {
    return target;
  }
  return '/';
}

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = sanitizeRedirectDest(searchParams.get('next'));
  const initialEmail = searchParams.get('email') || '';
  const initialPhone = searchParams.get('phone') || '';

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState(initialPhone);
  const [showPassword, setShowPassword] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ghostPrompt, setGhostPrompt] = useState<{
    ghost: any;
    cleanEmail: string;
    cleanPhone: string;
  } | null>(null);
  const [resolutionMode, setResolutionMode] = useState<'update' | 'secondary_keep' | 'primary_keep'>('update');

  const supabase = createClient();

  const executeSignup = async (ghostOptions?: ClaimProfileOptions) => {
    setLoading(true);
    setError('');
    setMessage('');

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();

    // Client/session rate limit protection (max 3/hr per session, max 5/day per session)
    const rateCheck = await checkAuthRateLimit('signup', cleanEmail);
    if (!rateCheck.allowed) {
      setError(
        rateCheck.message ||
          formatErrorWithCode(
            'Rate limit reached. Please try again later.',
            rateCheck.code || ERROR_CODES.AUTH_RATE_LIMIT_SESSION_1H
          )
      );
      setLoading(false);
      return;
    }

    const { data, error: authError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextUrl)}`,
        data: {
          full_name: fullName.trim(),
          phone: cleanPhone || null,
          notify_email: notifyEmail,
          resolve_ghost_id: ghostOptions?.ghostIdToMerge || null,
          resolve_mode: ghostOptions?.resolutionMode || null,
          ghost_email: ghostOptions?.ghostEmail || null,
        },
      },
    });

    if (authError) {
      const parsed = parseAuthError(authError);
      setError(formatErrorWithCode(parsed.message, parsed.code));
      setLoading(false);
    } else {
      setGhostPrompt(null);
      // If user session is returned immediately (e.g. email confirmation disabled)
      if (data.session && data.user) {
        await claimUserProfile(data.user, ghostOptions);
        router.push(nextUrl);
      } else {
        setMessage(
          'Account created! If email confirmation is enabled on your project, please check your inbox to activate.'
        );
        setLoading(false);
      }
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (password.length < 6) {
      setError(
        formatErrorWithCode(
          'Password must be at least 6 characters long.',
          ERROR_CODES.AUTH_PASSWORD_TOO_SHORT
        )
      );
      setLoading(false);
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const phoneDigits = cleanPhone.replace(/[^\d]/g, '');

    if (!cleanPhone || phoneDigits.length < 7) {
      setError(
        formatErrorWithCode(
          'Primary phone number is compulsory. Please enter your phone number.',
          ERROR_CODES.AUTH_INVALID_PHONE
        )
      );
      setLoading(false);
      return;
    }

    // 1. Check phone registration status across normal and ghost accounts
    const phoneStatus = await checkPhoneRegistrationStatus(cleanPhone, cleanEmail);
    if (phoneStatus.hasExistingAccount) {
      if (!phoneStatus.isGhost) {
        // Active registered user already has this phone number
        setError(
          formatErrorWithCode(
            `This phone number is already registered to another active account (${maskEmailAddress(
              phoneStatus.profile?.email
            )}). Please sign in using that account or use a different phone number.`,
            ERROR_CODES.AUTH_PHONE_EXISTS
          )
        );
        setLoading(false);
        return;
      } else {
        // Phone matches an existing ghost account
        if (
          phoneStatus.profile?.email &&
          !isSameEmail(phoneStatus.profile.email, cleanEmail) &&
          !phoneStatus.profile.email.endsWith('@phone.debtsync.local')
        ) {
          // Email mismatch! Prompt user with resolution options
          setGhostPrompt({
            ghost: phoneStatus.profile,
            cleanEmail,
            cleanPhone,
          });
          setLoading(false);
          return;
        }
      }
    }

    // 2. Check for duplicate accounts (taking Gmail aliases into account)
    const conflict = await checkIdentifierConflict(cleanEmail, cleanPhone);
    if (conflict.hasConflict) {
      const code = conflict.message?.toLowerCase().includes('phone')
        ? ERROR_CODES.AUTH_PHONE_EXISTS
        : ERROR_CODES.AUTH_EMAIL_EXISTS;
      setError(
        formatErrorWithCode(
          conflict.message || 'An account already exists with this email (or alias) or phone number.',
          code
        )
      );
      setLoading(false);
      return;
    }

    await executeSignup();
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4 sm:p-6 relative">
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="flex flex-col items-center justify-center text-center mb-8">
          <BrandLogo size="xl" href="/" />
        </div>

        <div className="bg-surface-container-lowest rounded-2xl p-6 sm:p-8 border border-outline-variant/40 shadow-xl">
          <h2 className="font-heading text-xl font-bold text-on-surface mb-1">
            Create Account
          </h2>
          <p className="text-sm text-on-surface-variant mb-6 font-medium">
            Join DebtSync to manage and track shared peer ledgers
          </p>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant block mb-1.5 font-semibold">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={`e.g. ${getRandomSampleName()}`}
                required
                className="w-full px-4 py-3 rounded-xl border border-outline-variant/50 bg-surface text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-medium"
              />
            </div>

            <div>
              <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant block mb-1.5 font-semibold">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-4 py-3 rounded-xl border border-outline-variant/50 bg-surface text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-medium"
              />
            </div>

            <div>
              <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant block mb-1.5 font-semibold">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  className="w-full px-4 py-3 pr-10 rounded-xl border border-outline-variant/50 bg-surface text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-medium"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px] hover:text-on-surface"
                >
                  {showPassword ? 'visibility_off' : 'visibility'}
                </button>
              </div>
            </div>

            <div>
              <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant block mb-1.5 font-semibold">
                Phone Number <span className="normal-case text-primary text-[11px] font-semibold">(compulsory primary contact)</span>
              </label>
              <PhoneInput
                value={phone}
                onChange={setPhone}
                defaultCountryCode="+91"
                required
              />
            </div>

            {/* Email & Notification Preference for New Registrations */}
            <div className="p-3.5 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 space-y-2.5">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-outline-variant text-[var(--primary)] focus:ring-primary/20 accent-[var(--primary)] shrink-0 cursor-pointer"
                />
                <div className="text-xs leading-relaxed min-w-0">
                  <span className="font-bold text-[var(--on-surface)] block">
                    Receive Email Receipts
                  </span>
                  <span className="text-[11px] text-[var(--on-surface-variant)] block mt-0.5">
                    Send email alerts when transactions or payments are recorded with you.
                    (Off by default to conserve email limits).
                  </span>
                </div>
              </label>

              <div className="pt-2 border-t border-[var(--outline-variant)]/20 flex items-start gap-2 text-[11px] text-[var(--primary)] leading-tight font-medium">
                <span className="material-symbols-outlined text-[16px] shrink-0 text-[var(--primary)]">notifications_active</span>
                <span>
                  💡 <strong>Tip:</strong> Free mobile &amp; desktop push alerts can be activated anytime in Settings—they work even when closed and don&apos;t consume email quotas!
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-primary text-on-primary rounded-xl font-bold font-mono text-sm hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 shadow-md cursor-pointer mt-2 min-h-[44px]"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          {message && (
            <div className="mt-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-mono space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-sm">
                <span className="material-symbols-outlined text-emerald-500 text-[18px]">mark_email_read</span>
                <span>Verification Email Dispatched</span>
              </div>
              <p>{message}</p>
              <div className="p-3 rounded-lg bg-[var(--surface-container-high)]/70 border border-amber-500/30 text-amber-800 dark:text-amber-200 space-y-1.5 text-[11px] leading-relaxed">
                <div className="flex items-center gap-1.5 font-bold">
                  <span className="material-symbols-outlined text-[16px] text-amber-500">mark_email_unread</span>
                  <span>Didn&apos;t receive the email yet?</span>
                </div>
                <p>
                  Please check your <strong>Spam / Junk folder</strong>. If the email arrived there, be sure to select <strong>&quot;Report Not Spam&quot;</strong> or move it to your primary inbox so future payment receipts, interest notifications, and security alerts reach you reliably.
                </p>
              </div>
            </div>
          )}
          {error && (
            <div className="mt-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-error text-xs font-mono">
              {error}
            </div>
          )}
        </div>

        {/* Existing Ghost Account Phone Resolution Modal */}
        {ghostPrompt && (
          <Modal
            isOpen={Boolean(ghostPrompt)}
            onClose={() => setGhostPrompt(null)}
            title="Existing Account Found with this Phone"
            subtitle={`Phone: ${ghostPrompt.cleanPhone}`}
            maxWidth="max-w-md"
          >
            <div className="space-y-4 font-mono text-xs">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <span className="material-symbols-outlined text-[18px]">contact_phone</span>
                  <span>Previous Ledger Activity Found</span>
                </div>
                <p className="text-[11px] text-[var(--on-surface)] leading-relaxed">
                  We found existing transactions and records linked to your phone number (<strong>{ghostPrompt.cleanPhone}</strong>), originally recorded under <strong>{maskEmailAddress(ghostPrompt.ghost.email)}</strong>.
                </p>
                <p className="text-[11px] text-[var(--on-surface-variant)]">
                  How would you like to link this account with your new email (<strong>{ghostPrompt.cleanEmail}</strong>)?
                </p>
              </div>

              <div className="space-y-2.5">
                <label
                  className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                    resolutionMode === 'update'
                      ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--on-surface)] shadow-xs'
                      : 'border-[var(--outline-variant)]/30 bg-[var(--surface-container)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="resolution"
                    value="update"
                    checked={resolutionMode === 'update'}
                    onChange={() => setResolutionMode('update')}
                    className="mt-0.5 accent-[var(--primary)] cursor-pointer"
                  />
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-bold text-xs text-[var(--on-surface)] flex items-center gap-1.5 flex-wrap">
                      <span>Update Account Email</span>
                      <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold uppercase">
                        Recommended
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Change the primary email to <strong>{ghostPrompt.cleanEmail}</strong>. All pending debts, transactions, and contacts will be transferred directly to your new email.
                    </p>
                  </div>
                </label>

                <label
                  className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                    resolutionMode === 'secondary_keep'
                      ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--on-surface)] shadow-xs'
                      : 'border-[var(--outline-variant)]/30 bg-[var(--surface-container)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="resolution"
                    value="secondary_keep"
                    checked={resolutionMode === 'secondary_keep'}
                    onChange={() => setResolutionMode('secondary_keep')}
                    className="mt-0.5 accent-[var(--primary)] cursor-pointer"
                  />
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-bold text-xs text-[var(--on-surface)]">
                      Primary + Secondary Email
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Set <strong>{ghostPrompt.cleanEmail}</strong> as primary, while keeping <strong>{maskEmailAddress(ghostPrompt.ghost.email)}</strong> as a secondary email. Transactions sent to either address will appear in your ledger.
                    </p>
                  </div>
                </label>

                <label
                  className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                    resolutionMode === 'primary_keep'
                      ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--on-surface)] shadow-xs'
                      : 'border-[var(--outline-variant)]/30 bg-[var(--surface-container)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="resolution"
                    value="primary_keep"
                    checked={resolutionMode === 'primary_keep'}
                    onChange={() => setResolutionMode('primary_keep')}
                    className="mt-0.5 accent-[var(--primary)] cursor-pointer"
                  />
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-bold text-xs text-[var(--on-surface)]">
                      Keep Previous as Primary
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Keep <strong>{maskEmailAddress(ghostPrompt.ghost.email)}</strong> as primary, and link <strong>{ghostPrompt.cleanEmail}</strong> as an authorized secondary email.
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--outline-variant)]/20">
                <button
                  type="button"
                  onClick={() => setGhostPrompt(null)}
                  className="px-3.5 py-2 rounded-xl bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    executeSignup({
                      ghostIdToMerge: ghostPrompt.ghost.id,
                      resolutionMode,
                      ghostEmail: ghostPrompt.ghost.email,
                    })
                  }
                  className="px-4 py-2 rounded-xl bg-[var(--primary)] hover:opacity-90 text-[var(--on-primary)] font-bold cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <span>{loading ? 'Creating account...' : 'Confirm & Create Account'}</span>
                </button>
              </div>
            </div>
          </Modal>
        )}

        <p className="text-center text-sm text-on-surface-variant mt-6">
          Already have an account?{' '}
          <Link
            href={`/login${nextUrl && nextUrl !== '/' ? `?next=${encodeURIComponent(nextUrl)}` : ''}`}
            className="text-primary font-bold hover:underline"
          >
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface flex items-center justify-center font-mono text-xs text-on-surface-variant">Loading...</div>}>
      <SignupContent />
    </Suspense>
  );
}
