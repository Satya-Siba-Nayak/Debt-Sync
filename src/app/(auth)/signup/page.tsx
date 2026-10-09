'use client';

import { useState, Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { checkIdentifierConflict } from '@/lib/utils/profile-lookup';
import { claimUserProfile } from '@/lib/utils/claim-profile';
import { getRandomSampleName } from '@/lib/utils/random-placeholders';
import { checkAuthRateLimit } from '@/lib/utils/rate-limit';
import { ERROR_CODES, formatErrorWithCode, parseAuthError } from '@/lib/constants/error-codes';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { BrandLogo } from '@/components/ui/BrandLogo';

function SignupContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get('next') || '/';
  const supabase = createClient();

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

    // Check for duplicate accounts (taking Gmail aliases and phone into account)
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
          phone: phone.trim() || null,
        },
      },
    });

    if (authError) {
      const parsed = parseAuthError(authError);
      setError(formatErrorWithCode(parsed.message, parsed.code));
      setLoading(false);
    } else {
      // If user session is returned immediately (e.g. email confirmation disabled)
      if (data.session && data.user) {
        await claimUserProfile(data.user);
        router.push(nextUrl);
      } else {
        setMessage(
          'Account created! If email confirmation is enabled on your project, please check your inbox to activate.'
        );
        setLoading(false);
      }
    }
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-primary text-on-primary rounded-xl font-bold font-mono text-sm hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 shadow-md cursor-pointer mt-2"
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
