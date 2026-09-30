'use client';

import { useState, Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { claimUserProfile } from '@/lib/utils/claim-profile';
import { checkAuthRateLimit, checkAccountStatusForLogin } from '@/lib/utils/rate-limit';
import { ERROR_CODES, formatErrorWithCode, parseAuthError } from '@/lib/constants/error-codes';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

function LoginContent() {
  const [authMode, setAuthMode] = useState<'password' | 'magic_link'>('password');
  const [identifier, setIdentifier] = useState('');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get('next') || '/';
  const isDeleted = searchParams.get('deleted') === 'true';
  const [message, setMessage] = useState(
    isDeleted ? 'Your DebtSync account and personal records have been permanently deleted.' : ''
  );
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailRecommendation, setEmailRecommendation] = useState<{
    type: 'secondary' | 'not_found' | 'shadow';
    primaryEmail?: string;
  } | null>(null);
  const supabase = createClient();

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    setEmailError('');
    setEmailRecommendation(null);

    const rawId = identifier.trim();
    if (!rawId) {
      setError(
        formatErrorWithCode(
          'Please enter your email or phone number.',
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        )
      );
      setLoading(false);
      return;
    }

    let targetEmail = rawId.toLowerCase();

    // Resolve alternate/work email or phone number to primary email
    try {
      const { data: resolvedEmail, error: rpcErr } = await supabase.rpc(
        'resolve_login_identifier',
        { p_identifier: rawId }
      );
      if (!rpcErr && resolvedEmail) {
        targetEmail = resolvedEmail;
      }
    } catch (_) {
      // Fallback to direct identifier
    }

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: targetEmail,
      password,
    });

    if (authError) {
      const parsed = parseAuthError(authError);
      setError(formatErrorWithCode(parsed.message, parsed.code));
      setLoading(false);
    } else {
      if (data?.user) {
        await claimUserProfile(data.user);
      }
      router.push(nextUrl);
    }
  };

  const handleMagicLinkLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    setEmailError('');
    setEmailRecommendation(null);

    const cleanEmail = primaryEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setEmailError('Please enter a valid email address');
      setLoading(false);
      return;
    }

    // 1. Check account existence & status first (do NOT send magic link if no account exists)
    const accountStatus = await checkAccountStatusForLogin(cleanEmail);

    if (accountStatus.status === 'not_found') {
      setEmailError(
        formatErrorWithCode(
          'No DebtSync account found with this email',
          ERROR_CODES.AUTH_ACCOUNT_NOT_FOUND
        )
      );
      setEmailRecommendation({ type: 'not_found' });
      setLoading(false);
      return;
    }

    if (accountStatus.status === 'secondary') {
      setEmailError(
        formatErrorWithCode(
          'Please use your primary email address for magic links',
          ERROR_CODES.AUTH_MAGIC_LINK_USE_PRIMARY
        )
      );
      setEmailRecommendation({
        type: 'secondary',
        primaryEmail: accountStatus.primary_email,
      });
      setLoading(false);
      return;
    }

    if (accountStatus.status === 'shadow') {
      setEmailError(
        formatErrorWithCode(
          'Account setup pending. Please sign up to activate.',
          ERROR_CODES.AUTH_SHADOW_SETUP_PENDING
        )
      );
      setEmailRecommendation({ type: 'shadow' });
      setLoading(false);
      return;
    }

    // 2. Background rate limit check: max 5 emails per 6 hours
    const rateCheck = await checkAuthRateLimit('magic_link', cleanEmail);
    if (!rateCheck.allowed) {
      setError(
        formatErrorWithCode(
          rateCheck.message || 'Too many magic link requests. Please wait a while.',
          rateCheck.code || ERROR_CODES.AUTH_RATE_LIMIT_EMAIL_6H
        )
      );
      setLoading(false);
      return;
    }

    // 3. Account exists and rate limit passed: send magic link
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextUrl)}`,
      },
    });

    if (authError) {
      const parsed = parseAuthError(authError);
      const errMsg = authError.message.toLowerCase();
      if (errMsg.includes('not found') || errMsg.includes('invalid') || errMsg.includes('user')) {
        setEmailError(
          formatErrorWithCode(
            'No account found with this email address',
            ERROR_CODES.AUTH_ACCOUNT_NOT_FOUND
          )
        );
        setEmailRecommendation({ type: 'not_found' });
      } else {
        setError(formatErrorWithCode(parsed.message, parsed.code));
      }
    } else {
      setMessage('Check your email for the magic link!');
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    const rawId = identifier.trim();
    if (!rawId) {
      setError(
        formatErrorWithCode(
          'Please enter your email or phone number first to reset your password',
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        )
      );
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    setEmailRecommendation(null);

    let targetEmail = rawId.toLowerCase();
    try {
      const { data: resolved } = await supabase.rpc('resolve_login_identifier', {
        p_identifier: rawId,
      });
      if (resolved) targetEmail = resolved;
    } catch (_) {}

    // Verify account existence before sending password reset
    const accountStatus = await checkAccountStatusForLogin(targetEmail);
    if (accountStatus.status === 'not_found') {
      setError(
        formatErrorWithCode(
          'No account found with this email or phone. Please sign up to create an account.',
          ERROR_CODES.AUTH_ACCOUNT_NOT_FOUND
        )
      );
      setLoading(false);
      return;
    }

    // Rate limit check: max 5 emails per 6 hours
    const rateCheck = await checkAuthRateLimit('password_reset', targetEmail);
    if (!rateCheck.allowed) {
      setError(
        formatErrorWithCode(
          rateCheck.message || 'Too many password reset requests. Please wait a while.',
          rateCheck.code || ERROR_CODES.AUTH_RATE_LIMIT_EMAIL_6H
        )
      );
      setLoading(false);
      return;
    }

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      targetEmail,
      {
        redirectTo: `${window.location.origin}/settings`,
      }
    );

    if (resetError) {
      const parsed = parseAuthError(resetError);
      setError(formatErrorWithCode(parsed.message, parsed.code));
    } else {
      setMessage('Password reset instructions have been sent to your primary email.');
    }
    setLoading(false);
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

        {/* Card */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 sm:p-8 border border-outline-variant/40 shadow-xl">
          {/* Auth Mode Toggle Tabs */}
          <div className="flex bg-surface-container p-1 rounded-xl mb-6 border border-outline-variant/20">
            <button
              type="button"
              onClick={() => {
                setAuthMode('password');
                setError('');
                setMessage('');
              }}
              className={`flex-1 py-1.5 font-mono text-xs font-bold rounded-lg transition-all ${
                authMode === 'password'
                  ? 'bg-surface-container-lowest text-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('magic_link');
                setError('');
                setMessage('');
              }}
              className={`flex-1 py-1.5 font-mono text-xs font-bold rounded-lg transition-all ${
                authMode === 'magic_link'
                  ? 'bg-surface-container-lowest text-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Magic Link
            </button>
          </div>

          <h2 className="font-heading text-xl font-bold text-on-surface mb-1">
            Sign In
          </h2>
          <p className="text-sm text-on-surface-variant mb-6 font-medium">
            {authMode === 'password'
              ? 'Enter your credentials to access your ledger'
              : 'Enter your email to receive a sign-in link'}
          </p>

          <form
            onSubmit={authMode === 'password' ? handlePasswordLogin : handleMagicLinkLogin}
            className="space-y-4"
          >
            {authMode === 'password' ? (
              <div>
                <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant block mb-1.5 font-semibold">
                  Email / Phone
                </label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="name@example.com or phone"
                  required
                  autoComplete="username"
                  className="w-full px-4 py-3 rounded-xl border border-outline-variant/50 bg-surface text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-medium"
                />
              </div>
            ) : (
              <div>
                <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant block mb-1.5 font-semibold">
                  Email
                </label>
                <input
                  type="email"
                  value={primaryEmail}
                  onChange={(e) => {
                    setPrimaryEmail(e.target.value);
                    if (emailError) setEmailError('');
                    if (error) setError('');
                  }}
                  placeholder="name@example.com"
                  required
                  autoComplete="email"
                  className={`w-full px-4 py-3 rounded-xl border ${
                    emailError ? 'border-error ring-1 ring-error/40' : 'border-outline-variant/50'
                  } bg-surface text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-medium`}
                />
                {emailError && (
                  <p className="text-[11px] font-mono text-error mt-1.5 flex items-center gap-1 animate-fadeIn">
                    <span className="material-symbols-outlined text-[13px]">error</span>
                    <span>{emailError}</span>
                  </p>
                )}

                {emailRecommendation?.type === 'not_found' && (
                  <div className="mt-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-mono text-on-surface space-y-1 animate-fadeIn">
                    <div className="flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
                      <span className="material-symbols-outlined text-[15px]">person_off</span>
                      <span>No Account Found</span>
                    </div>
                    <p className="text-[11px] text-on-surface-variant leading-relaxed">
                      No DebtSync account is registered to this email.{' '}
                      <Link
                        href={`/signup${nextUrl && nextUrl !== '/' ? `?next=${encodeURIComponent(nextUrl)}` : ''}`}
                        className="text-primary font-bold hover:underline"
                      >
                        Create an account here
                      </Link>
                      , or if you already have an account under another email, sign in with that address and add this as a secondary email in Account Settings.
                    </p>
                  </div>
                )}

                {emailRecommendation?.type === 'secondary' && (
                  <div className="mt-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-mono text-on-surface space-y-1 animate-fadeIn">
                    <div className="flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
                      <span className="material-symbols-outlined text-[15px]">alternate_email</span>
                      <span>Secondary Email Address</span>
                    </div>
                    <p className="text-[11px] text-on-surface-variant leading-relaxed">
                      This address is registered as a secondary/work email{emailRecommendation.primaryEmail ? ` for ${emailRecommendation.primaryEmail}` : ''}.
                      Magic links are only sent to primary accounts. Switch to the{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('password');
                          setIdentifier(primaryEmail);
                          setEmailRecommendation(null);
                        }}
                        className="text-primary font-bold hover:underline cursor-pointer"
                      >
                        Password tab
                      </button>{' '}
                      to sign in with this email, or enter your primary email.
                    </p>
                  </div>
                )}

                {emailRecommendation?.type === 'shadow' && (
                  <div className="mt-2.5 p-3 rounded-xl bg-primary/10 border border-primary/30 text-xs font-mono text-on-surface space-y-1 animate-fadeIn">
                    <div className="flex items-center gap-1.5 font-bold text-primary">
                      <span className="material-symbols-outlined text-[15px]">mail</span>
                      <span>Invitation Pending</span>
                    </div>
                    <p className="text-[11px] text-on-surface-variant leading-relaxed">
                      A peer has recorded debts with you, but you have not created your DebtSync account yet.{' '}
                      <Link
                        href={`/signup${nextUrl && nextUrl !== '/' ? `?next=${encodeURIComponent(nextUrl)}` : ''}`}
                        className="text-primary font-bold hover:underline"
                      >
                        Sign up to activate your account
                      </Link>{' '}
                      and access your shared ledger.
                    </p>
                  </div>
                )}
              </div>
            )}

            {authMode === 'password' && (
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant font-semibold">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="font-mono text-[11px] text-primary hover:underline"
                  >
                    Forgot?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError('');
                    }}
                    placeholder="••••••••"
                    required
                    className="w-full px-4 py-3 pr-10 rounded-xl border border-outline-variant/50 bg-surface text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px] hover:text-on-surface cursor-pointer"
                  >
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-primary text-on-primary rounded-xl font-bold font-mono text-sm hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 shadow-md cursor-pointer mt-2"
            >
              {loading
                ? 'Processing...'
                : authMode === 'password'
                ? 'Sign In'
                : 'Send Magic Link'}
            </button>
          </form>

          {message && (
            <div className="mt-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-mono space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-sm">
                <span className="material-symbols-outlined text-emerald-500 text-[18px]">mark_email_read</span>
                <span>Instructions Dispatched</span>
              </div>
              <p>{message}</p>
              <div className="p-3 rounded-lg bg-[var(--surface-container-high)]/70 border border-amber-500/30 text-amber-800 dark:text-amber-200 space-y-1.5 text-[11px] leading-relaxed">
                <div className="flex items-center gap-1.5 font-bold">
                  <span className="material-symbols-outlined text-[16px] text-amber-500">mark_email_unread</span>
                  <span>Can&apos;t find the email in your inbox?</span>
                </div>
                <p>
                  Please check your <strong>Spam / Junk folder</strong>. If the email is in spam, mark it as <strong>&quot;Report Not Spam&quot;</strong> or move it to your inbox to ensure instantaneous login link delivery in the future.
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
          Don&apos;t have an account?{' '}
          <Link
            href={`/signup${nextUrl && nextUrl !== '/' ? `?next=${encodeURIComponent(nextUrl)}` : ''}`}
            className="text-primary font-bold hover:underline"
          >
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface flex items-center justify-center font-mono text-xs text-on-surface-variant">Loading...</div>}>
      <LoginContent />
    </Suspense>
  );
}
