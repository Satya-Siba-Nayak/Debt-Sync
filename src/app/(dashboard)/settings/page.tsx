'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SUPPORTED_CURRENCIES } from '@/lib/utils/currency';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { COUNTRY_CODES, CountryCode } from '@/lib/constants/country-codes';
import { checkIdentifierConflict } from '@/lib/utils/profile-lookup';
import { isSameEmail } from '@/lib/utils/email-normalize';
import { Avatar, AVATAR_PRESETS } from '@/components/ui/Avatar';
import { getRandomSecondaryEmailPlaceholder } from '@/lib/utils/random-placeholders';
import { AvatarCropModal } from '@/components/profile/AvatarCropModal';

export default function SettingsPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [currency, setCurrency] = useState('inr');
  const [defaultCountryCode, setDefaultCountryCode] = useState('+91');
  const [newPassword, setNewPassword] = useState('');
  const [secondaryEmails, setSecondaryEmails] = useState<string[]>([]);
  const [newSecondaryEmail, setNewSecondaryEmail] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [showAllPresets, setShowAllPresets] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsStandalone(
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true
      );

      const handler = (e: any) => {
        e.preventDefault();
        setDeferredInstallPrompt(e);
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }
  }, []);

  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setUserId(user.id);
        setEmail(user.email || '');

        // Load profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, phone, secondary_emails, avatar_url')
          .eq('id', user.id)
          .single();

        if (profile) {
          setFullName(profile.full_name || '');
          setPhone(profile.phone || '');
          setSecondaryEmails(profile.secondary_emails || []);
          setAvatarUrl(profile.avatar_url || null);
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/') && !file.name.match(/\.(jpe?g|png|webp|gif|bmp|heic|svg)$/i)) {
      setError('Please select a valid image file (PNG, JPG, WebP, etc.)');
      return;
    }

    setError('');
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setCropImageSrc(result);
        setIsCropModalOpen(true);
      }
    };
    reader.onerror = () => {
      setError('Failed to load selected image file');
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = '';
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check phone uniqueness before saving
      if (phone.trim()) {
        const phoneConflict = await checkIdentifierConflict(undefined, phone.trim(), user.id);
        if (phoneConflict.hasConflict) {
          throw new Error(phoneConflict.message || 'This phone number is already registered to another account.');
        }
      }

      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          secondary_emails: secondaryEmails,
          avatar_url: avatarUrl,
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('debtsync:user_updated', {
            detail: { avatarUrl, fullName: fullName.trim() },
          })
        );
      }

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
        <div className="space-y-5">
          <h3 className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)]">
            Profile Information
          </h3>

          {/* Avatar / Profile Picture */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/20 overflow-hidden">
            <div className="relative group self-start sm:self-center shrink-0">
              <Avatar src={avatarUrl} name={fullName || email} size="xl" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 bg-black/40 rounded-3xl opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity cursor-pointer"
                title="Change Photo"
              >
                <span className="material-symbols-outlined text-2xl">photo_camera</span>
              </button>
            </div>

            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/*"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">upload</span>
                  <span>Upload Photo</span>
                </button>

                {avatarUrl && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setCropImageSrc(avatarUrl);
                        setIsCropModalOpen(true);
                      }}
                      className="px-3.5 py-1.5 rounded-xl border border-primary/40 bg-primary/10 text-primary font-mono text-xs font-bold hover:bg-primary/20 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                      title="Crop and zoom avatar"
                    >
                      <span className="material-symbols-outlined text-[16px]">crop</span>
                      <span>Edit &amp; Crop</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAvatarUrl(null)}
                      className="px-3 py-1.5 rounded-xl border border-[var(--outline-variant)]/40 hover:bg-red-500/10 hover:text-[var(--error)] text-[var(--on-surface-variant)] font-mono text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>

              {/* Presets Gallery with Cute Arrow Toggle */}
              <div className="pt-0.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[11px] text-[var(--outline)]">
                    Or choose a preset avatar:
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllPresets(!showAllPresets)}
                    className="text-[11px] font-mono text-[var(--primary)] hover:underline flex items-center gap-1 cursor-pointer"
                    title={showAllPresets ? 'Collapse preset avatars' : 'Expand all preset avatars'}
                  >
                    <span>{showAllPresets ? 'Show less' : `+${AVATAR_PRESETS.length - 6} more`}</span>
                    <span className="material-symbols-outlined text-[14px]">
                      {showAllPresets ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
                    </span>
                  </button>
                </div>

                {/* Collapsed Row: 6 presets + cute arrow button */}
                {!showAllPresets ? (
                  <div className="flex items-center gap-2">
                    {AVATAR_PRESETS.slice(0, 6).map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          if (avatarUrl === preset.url) {
                            setCropImageSrc(preset.url);
                            setIsCropModalOpen(true);
                          } else {
                            setAvatarUrl(preset.url);
                          }
                        }}
                        className={`relative w-8 h-8 rounded-xl overflow-hidden border-2 transition-transform hover:scale-105 shrink-0 cursor-pointer ${
                          avatarUrl === preset.url
                            ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/30 scale-105'
                            : 'border-transparent opacity-80 hover:opacity-100'
                        }`}
                        title={avatarUrl === preset.url ? `${preset.label} (Click to Crop & Zoom)` : preset.label}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={preset.url} alt={preset.label} className="w-full h-full object-cover pointer-events-none" />
                        {avatarUrl === preset.url && (
                          <div className="absolute inset-0 bg-[var(--primary)]/20 flex items-center justify-center text-white backdrop-blur-[0.5px]">
                            <span className="material-symbols-outlined text-[12px] text-[var(--primary)]">crop</span>
                          </div>
                        )}
                      </button>
                    ))}

                    {/* Cute Arrow Button to expand all */}
                    <button
                      type="button"
                      onClick={() => setShowAllPresets(true)}
                      className="w-8 h-8 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--primary)] flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-2xs group"
                      title={`Show ${AVATAR_PRESETS.length - 6} more preset avatars`}
                    >
                      <span className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-y-0.5">
                        keyboard_arrow_down
                      </span>
                    </button>
                  </div>
                ) : (
                  /* Expanded Grid: All presets cleanly contained in a tidy grid */
                  <div className="p-2 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30">
                    <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                      {AVATAR_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            if (avatarUrl === preset.url) {
                              setCropImageSrc(preset.url);
                              setIsCropModalOpen(true);
                            } else {
                              setAvatarUrl(preset.url);
                            }
                          }}
                          className={`relative w-8 h-8 rounded-xl overflow-hidden border-2 transition-transform hover:scale-105 shrink-0 cursor-pointer ${
                            avatarUrl === preset.url
                              ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/30 scale-105'
                              : 'border-transparent opacity-80 hover:opacity-100'
                          }`}
                          title={avatarUrl === preset.url ? `${preset.label} (Click to Crop & Zoom)` : preset.label}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={preset.url} alt={preset.label} className="w-full h-full object-cover pointer-events-none" />
                          {avatarUrl === preset.url && (
                            <div className="absolute inset-0 bg-[var(--primary)]/20 flex items-center justify-center text-white backdrop-blur-[0.5px]">
                              <span className="material-symbols-outlined text-[12px] text-[var(--primary)]">crop</span>
                            </div>
                          )}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowAllPresets(false)}
                        className="w-8 h-8 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface-container-high)] hover:bg-[var(--surface-container-highest)] text-[var(--primary)] flex items-center justify-center transition-all cursor-pointer shrink-0 group"
                        title="Collapse presets"
                      >
                        <span className="material-symbols-outlined text-[18px] transition-transform group-hover:-translate-y-0.5">
                          keyboard_arrow_up
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

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
                placeholder={`e.g. ${getRandomSecondaryEmailPlaceholder()}`}
                className="flex-1 px-4 py-2 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
              />
              <button
                type="button"
                onClick={async () => {
                  const clean = newSecondaryEmail.trim().toLowerCase();
                  if (!clean) return;
                  if (isSameEmail(clean, email)) {
                    setError('This email (or its alias) is already your primary account email.');
                    return;
                  }
                  if (secondaryEmails.some((sec) => isSameEmail(sec, clean))) {
                    setError('This email (or its alias) is already in your secondary emails list.');
                    return;
                  }
                  const emailConflict = await checkIdentifierConflict(clean, undefined, userId || undefined);
                  if (emailConflict.hasConflict) {
                    setError(emailConflict.message || 'This email address is already linked to another account.');
                    return;
                  }
                  setError('');
                  setSecondaryEmails([...secondaryEmails, clean]);
                  setNewSecondaryEmail('');
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

        {/* PWA & Mobile App */}
        <div className="pt-6 border-t border-[var(--outline-variant)]/20 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)]">
                Installable App (PWA)
              </h3>
              <p className="text-xs text-[var(--on-surface-variant)] mt-0.5">
                {isStandalone
                  ? 'DebtSync is currently running in standalone installed app mode.'
                  : 'Install DebtSync on your phone or computer for instant home-screen launch and offline support.'}
              </p>
            </div>
            <div>
              {isStandalone ? (
                <span className="px-3 py-1.5 rounded-xl text-xs font-mono font-bold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 inline-flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  Installed
                </span>
              ) : deferredInstallPrompt ? (
                <button
                  type="button"
                  onClick={async () => {
                    deferredInstallPrompt.prompt();
                    const choice = await deferredInstallPrompt.userChoice;
                    if (choice.outcome === 'accepted') setIsStandalone(true);
                    setDeferredInstallPrompt(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-xs inline-flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[18px]">install_mobile</span>
                  Install App
                </button>
              ) : (
                <span className="text-xs font-mono text-[var(--outline)]">
                  Use browser menu &rarr; &quot;Add to Home Screen&quot;
                </span>
              )}
            </div>
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

      {userId && (
        <AvatarCropModal
          isOpen={isCropModalOpen}
          onClose={() => {
            setIsCropModalOpen(false);
            setCropImageSrc(null);
          }}
          imageSrc={cropImageSrc}
          userId={userId}
          onAvatarSaved={(newUrl) => {
            setAvatarUrl(newUrl);
            setMessage('Profile picture cropped, optimized under 5MB, and saved successfully!');
          }}
        />
      )}
    </div>
  );
}
