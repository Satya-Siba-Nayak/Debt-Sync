'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SUPPORTED_CURRENCIES } from '@/lib/utils/currency';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { COUNTRY_CODES, CountryCode } from '@/lib/constants/country-codes';

export default function SettingsPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [currency, setCurrency] = useState('inr');
  const [defaultCountryCode, setDefaultCountryCode] = useState('+91');
  const [newPassword, setNewPassword] = useState('');
  const [secondaryEmails, setSecondaryEmails] = useState<string[]>([]);
  const [newSecondaryEmail, setNewSecondaryEmail] = useState('');

  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setEmail(user.email || '');

        // Load profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, phone, secondary_emails')
          .eq('id', user.id)
          .single();

        if (profile) {
          setFullName(profile.full_name || '');
          setPhone(profile.phone || '');
          setSecondaryEmails(profile.secondary_emails || []);
        }

        const localCode = typeof window !== 'undefined' ? localStorage.getItem('debtsync_default_country_code') : null;

        // Load settings
        const { data: userSettings } = await supabase
          .from('user_settings')
          .select('default_currency, default_country_code')
          .eq('user_id', user.id)
          .single();

        if (userSettings?.default_currency) {
          setCurrency(userSettings.default_currency);
        }
        if ((userSettings as any)?.default_country_code) {
          setDefaultCountryCode((userSettings as any).default_country_code);
        } else if (localCode) {
          setDefaultCountryCode(localCode);
        }
      } catch (err) {
        console.error('Error loading settings:', err);
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, [supabase]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          secondary_emails: secondaryEmails,
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      // Merge any shadow profiles that match these secondary emails
      for (const secEmail of secondaryEmails) {
        const { data: shadowList } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', secEmail.toLowerCase())
          .eq('is_shadow', true);

        if (shadowList && shadowList.length > 0) {
          for (const shadow of shadowList) {
            // Re-point debts from shadow to real user
            await supabase.from('debts').update({ lender_id: user.id }).eq('lender_id', shadow.id);
            await supabase.from('debts').update({ borrower_id: user.id }).eq('borrower_id', shadow.id);
            // Delete shadow profile
            await supabase.from('profiles').delete().eq('id', shadow.id);
          }
        }
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('debtsync_default_country_code', defaultCountryCode);
      }

      // Update user_settings
      const settingsPayload: any = {
        user_id: user.id,
        default_currency: currency,
        default_country_code: defaultCountryCode,
        updated_at: new Date().toISOString(),
      };

      const { error: settingsError } = await supabase
        .from('user_settings')
        .upsert(settingsPayload);

      if (settingsError && settingsError.message?.includes('default_country_code')) {
        delete settingsPayload.default_country_code;
        await supabase.from('user_settings').upsert(settingsPayload);
      } else if (settingsError) {
        throw settingsError;
      }

      // Update password if entered
      if (newPassword.trim()) {
        if (newPassword.trim().length < 6) {
          throw new Error('Password must be at least 6 characters long');
        }
        const { error: pwdError } = await supabase.auth.updateUser({
          password: newPassword.trim(),
        });
        if (pwdError) throw pwdError;
        setNewPassword('');
      }

      setMessage('Settings updated successfully!');
    } catch (err: any) {
      setError(err.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 md:space-y-8">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)]">
          Account Settings
        </h1>
        <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-1">
          Personal preferences, currency defaults, and theme controls
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm space-y-6"
      >
        {message && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-xs font-mono">
            {message}
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-[var(--error)] text-xs font-mono">
            {error}
          </div>
        )}

        {/* Profile Details */}
        <div className="space-y-4">
          <h3 className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)]">
            Profile Information
          </h3>

          <div>
            <label className="font-mono text-xs text-[var(--on-surface-variant)] block mb-1">
              Primary Email
            </label>
            <input
              type="email"
              disabled
              value={email}
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/20 bg-[var(--surface-container-low)] text-[var(--on-surface-variant)] text-sm cursor-not-allowed"
            />
          </div>

          <div>
            <label className="font-mono text-xs text-[var(--on-surface-variant)] block mb-1">
              Secondary / Alternate Emails <span className="normal-case text-[var(--outline)]">(College, Work, etc.)</span>
            </label>
            <p className="text-[11px] font-mono text-[var(--on-surface-variant)] mb-2">
              If someone adds you by any of these emails, their transactions will automatically link to your account.
            </p>

            {/* List of active secondary emails */}
            {secondaryEmails.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {secondaryEmails.map((sec) => (
                  <span
                    key={sec}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[var(--surface-container)] text-[var(--primary)] font-mono text-xs font-semibold border border-[var(--outline-variant)]/30"
                  >
                    <span>{sec}</span>
                    <button
                      type="button"
                      onClick={() => setSecondaryEmails(secondaryEmails.filter((e) => e !== sec))}
                      className="text-[var(--on-surface-variant)] hover:text-[var(--error)] ml-1"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Add email input */}
            <div className="flex gap-2">
              <input
                type="email"
                value={newSecondaryEmail}
                onChange={(e) => setNewSecondaryEmail(e.target.value)}
                placeholder="e.g. satya@college.edu or satya@work.com"
                className="flex-1 px-4 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
              />
              <button
                type="button"
                onClick={() => {
                  const clean = newSecondaryEmail.trim().toLowerCase();
                  if (clean && !secondaryEmails.includes(clean) && clean !== email.toLowerCase()) {
                    setSecondaryEmails([...secondaryEmails, clean]);
                    setNewSecondaryEmail('');
                  }
                }}
                className="px-4 py-2 bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--primary)] font-mono text-xs font-bold rounded-xl border border-[var(--outline-variant)]/30"
              >
                + Add
              </button>
            </div>
          </div>

          <div>
            <label className="font-mono text-xs text-[var(--on-surface-variant)] block mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div>
            <label className="font-mono text-xs text-[var(--on-surface-variant)] block mb-1">
              Phone Number <span className="normal-case text-[var(--outline)]">(for peer directory contact)</span>
            </label>
            <PhoneInput
              value={phone}
              onChange={setPhone}
              defaultCountryCode={defaultCountryCode}
            />
          </div>
        </div>

        {/* Preferences */}
        <div className="pt-6 border-t border-[var(--outline-variant)]/20 space-y-4">
          <h3 className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)]">
            Regional &amp; Appearance Defaults
          </h3>

          <div>
            <label className="font-mono text-xs text-[var(--on-surface-variant)] block mb-1">
              Account Default Currency
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)] font-mono"
            >
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code.toUpperCase()} ({c.symbol}) — {c.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] font-mono text-[var(--on-surface-variant)] mt-1">
              Powered by Fawaz Ahmed exchange rates API. Cross-currency debts automatically convert to your native currency.
            </p>
          </div>

          <div>
            <label className="font-mono text-xs text-[var(--on-surface-variant)] block mb-1">
              Default Phone Country Code
            </label>
            <select
              value={defaultCountryCode}
              onChange={(e) => setDefaultCountryCode(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)] font-mono"
            >
              {COUNTRY_CODES.map((c: CountryCode) => (
                <option key={`${c.code}-${c.dialCode}`} value={c.dialCode}>
                  {c.flag} {c.name} ({c.dialCode})
                </option>
              ))}
            </select>
            <p className="text-[11px] font-mono text-[var(--on-surface-variant)] mt-1">
              Preselected country code when adding contacts or recording debts. Default: India (+91).
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div>
              <span className="font-mono text-xs text-[var(--on-surface-variant)] font-semibold block">
                Theme Appearance
              </span>
              <span className="text-[11px] font-mono text-[var(--outline)]">
                Light, Dark, or sync with OS
              </span>
            </div>
            <ThemeToggle />
          </div>
        </div>

        {/* Security & Password */}
        <div className="pt-6 border-t border-[var(--outline-variant)]/20 space-y-4">
          <h3 className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)]">
            Security &amp; Password
          </h3>
          <p className="text-xs text-[var(--on-surface-variant)]">
            Set or update your password to sign in quickly without waiting for email magic links.
          </p>

          <div>
            <label className="font-mono text-xs text-[var(--on-surface-variant)] block mb-1">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Leave blank to keep unchanged"
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--outline-variant)]/20 flex justify-end">
          <button
            type="submit"
            disabled={saving || loading}
            className="py-2.5 px-6 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-95 shadow-sm transition-all disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
