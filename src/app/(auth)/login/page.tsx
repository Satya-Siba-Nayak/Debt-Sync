'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (authError) {
      setError(authError.message);
    } else {
      setMessage('Check your email for the magic link!');
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
          <h2 className="font-heading text-xl font-bold text-on-surface mb-1">
            Sign In
          </h2>
          <p className="text-sm text-on-surface-variant mb-6 font-medium">
            Enter your email to receive a passwordless magic link
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="font-mono text-xs tracking-wider uppercase text-on-surface-variant block mb-2 font-semibold">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu or you@gmail.com"
                required
                className="w-full px-4 py-3 rounded-xl border border-outline-variant/50 bg-surface text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-medium"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-primary text-on-primary rounded-xl font-bold font-mono text-sm hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 shadow-md cursor-pointer"
            >
              {loading ? 'Sending link...' : 'Send Magic Link'}
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
          <Link href="/signup" className="text-primary font-bold hover:underline">
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
}
