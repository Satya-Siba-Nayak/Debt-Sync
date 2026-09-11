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

    // Check for duplicate accounts (taking Gmail aliases and phone into account)
    const conflict = await checkIdentifierConflict(cleanEmail, phone.trim() || undefined);
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
        <div className="text-center mb-8">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-primary text-on-primary font-bold text-2xl items-center justify-center mb-3 shadow-lg shadow-primary/20">
            D
          </div>
          <h1 className="font-heading text-3xl font-bold text-on-surface tracking-tight">
            DebtSync
          </h1>
          <p className="font-mono text-xs tracking-widest uppercase text-on-surface-variant mt-1 font-semibold">
            Trust &amp; Precision
          </p>
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
                Phone Number <span className="normal-case text-outline text-[11px]">(optional, for directory)</span>
              </label>
              <PhoneInput
                value={phone}
                onChange={setPhone}
                defaultCountryCode="+91"
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
            <div className="mt-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-mono">
              {message}
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
