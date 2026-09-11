'use client';

import { useState, Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { claimUserProfile } from '@/lib/utils/claim-profile';

function LoginContent() {
  const [authMode, setAuthMode] = useState<'password' | 'magic_link'>('password');
  const [identifier, setIdentifier] = useState('');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get('next') || '/';
  const supabase = createClient();

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    const rawId = identifier.trim();
    if (!rawId) {
      setError('Please enter your email, alternate email, or phone number');
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
      setError(authError.message);
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

    const cleanEmail = primaryEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Magic link requires a valid primary email address');
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextUrl)}`,
      },
    });

    if (authError) {
      setError(authError.message);
    } else {
      setMessage('Check your primary email for the magic link!');
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    const rawId = identifier.trim();
    if (!rawId) {
      setError('Please enter your email or phone number first to reset your password');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');

    let targetEmail = rawId.toLowerCase();
    try {
      const { data: resolved } = await supabase.rpc('resolve_login_identifier', {
        p_identifier: rawId,
      });
      if (resolved) targetEmail = resolved;
    } catch (_) {}

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      targetEmail,
      {
        redirectTo: `${window.location.origin}/settings`,
      }
    );

    if (resetError) {
      setError(resetError.message);
    } else {
      setMessage('Password reset instructions have been sent to your primary email.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4 sm:p-6">
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
              ? 'Sign in with your primary email, secondary email, or phone'
              : 'Enter your primary email for a secure passwordless link'}
          </p>

          <form
            onSubmit={authMode === 'password' ? handlePasswordLogin : handleMagicLinkLogin}
            className="space-y-4"
          >
            {authMode === 'password' ? (
              <div>
                <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant block mb-1.5 font-semibold">
                  Email, Alternate Email, or Phone
                </label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Primary email, work email, or +91 phone"
                  required
                  autoComplete="username"
                  className="w-full px-4 py-3 rounded-xl border border-outline-variant/50 bg-surface text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-medium"
                />
              </div>
            ) : (
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant font-semibold">
                    Primary Email Address
                  </label>
                  <span className="text-[10px] font-mono text-[var(--outline)] uppercase font-semibold">
                    Primary Only
                  </span>
                </div>
                <input
                  type="email"
                  value={primaryEmail}
                  onChange={(e) => setPrimaryEmail(e.target.value)}
                  placeholder="you@example.com (Primary email only)"
                  required
                  autoComplete="email"
                  className="w-full px-4 py-3 rounded-xl border border-outline-variant/50 bg-surface text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-medium"
                />
                <p className="text-[11px] font-mono text-on-surface-variant mt-1.5">
                  Magic links are strictly sent to your registered primary email address.
                </p>
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
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
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
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-primary text-on-primary rounded-xl font-bold font-mono text-sm hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 shadow-md cursor-pointer mt-2"
            >
              {loading
                ? 'Processing...'
                : authMode === 'password'
                ? 'Sign In with Password'
                : 'Send Magic Link'}
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
