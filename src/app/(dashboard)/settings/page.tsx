'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency, SUPPORTED_CURRENCIES } from '@/lib/utils/currency';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Modal } from '@/components/ui/Modal';
import { calculateDebtBalance, round2 } from '@/lib/utils/interest';
import { exportUserDataToCSV } from '@/lib/utils/export-csv';
import { COUNTRY_CODES, CountryCode } from '@/lib/constants/country-codes';
import { checkIdentifierConflict } from '@/lib/utils/profile-lookup';
import { isSameEmail } from '@/lib/utils/email-normalize';
import { Avatar, AVATAR_PRESETS } from '@/components/ui/Avatar';
import { getRandomSecondaryEmailPlaceholder } from '@/lib/utils/random-placeholders';
import { AvatarCropModal } from '@/components/profile/AvatarCropModal';
import { getStoredTheme } from '@/lib/utils/theme';
import {
  isPresetAvatar,
  removeCustomAvatar,
  getLocalRecentAvatars,
  setLocalRecentAvatars,
} from '@/lib/utils/avatar-storage';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { triggerPWAInstallPrompt } from '@/components/ui/PWAInstallPrompt';
import { isValidUPIId } from '@/lib/utils/upi-link';

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
  const [upiId, setUpiId] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [recentCustomAvatars, setRecentCustomAvatars] = useState<string[]>([]);
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
  const [showAdvancedApp, setShowAdvancedApp] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewMode, setViewMode] = useState<'admin' | 'user'>('admin');
  const [promotingAdmin, setPromotingAdmin] = useState(false);

  // Account deletion & CSV export states
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [debtObligations, setDebtObligations] = useState<{
    activeCount: number;
    pendingCount: number;
    totalBalance: number;
    canDelete: boolean;
  }>({ activeCount: 0, pendingCount: 0, totalBalance: 0, canDelete: false });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const localViewMode = localStorage.getItem('debtsync_view_mode') as 'admin' | 'user' | null;
      if (localViewMode) setViewMode(localViewMode);

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
        const user = await getCurrentUserFast(supabase);
        if (!user) return;
        setUserId(user.id);
        setEmail(user.email || '');

        // Load profile
        let profile: any = null;
        const { data: pData, error: pErr } = await supabase
          .from('profiles')
          .select('full_name, phone, secondary_emails, avatar_url, recent_custom_avatars, upi_id, is_admin')
          .eq('id', user.id)
          .single();

        if (!pErr && pData) {
          profile = pData;
        } else {
          // Graceful fallback if columns are not yet migrated
          const { data: fallbackData } = await supabase
            .from('profiles')
            .select('full_name, phone, secondary_emails, avatar_url')
            .eq('id', user.id)
            .single();
          profile = fallbackData;
        }

        if (profile) {
          setFullName(profile.full_name || '');
          setPhone(profile.phone || '');
          setUpiId(profile.upi_id || '');
          setIsAdmin(Boolean(profile.is_admin));
          setSecondaryEmails(profile.secondary_emails || []);
          setAvatarUrl(profile.avatar_url || null);

          // Resolve recent custom avatars (strictly custom photos, max 2)
          const rawRecent = Array.isArray(profile.recent_custom_avatars)
            ? profile.recent_custom_avatars.filter((u: string) => u && !isPresetAvatar(u))
            : getLocalRecentAvatars(user.id);

          // If current avatar is a custom photo, make sure it's reflected in recent list
          let initialRecent = rawRecent;
          if (
            profile.avatar_url &&
            !isPresetAvatar(profile.avatar_url) &&
            !initialRecent.includes(profile.avatar_url)
          ) {
            initialRecent = [profile.avatar_url, ...initialRecent].slice(0, 2);
          }

          setRecentCustomAvatars(initialRecent.slice(0, 2));
          setLocalRecentAvatars(user.id, initialRecent.slice(0, 2));
        }

        const localCode = typeof window !== 'undefined' ? localStorage.getItem('debtsync_default_country_code') : null;

        // Load settings
        const { data: userSettings } = await supabase
          .from('user_settings')
          .select('default_currency, default_country_code, theme_preference')
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

        // Load user debts to evaluate account deletion eligibility
        const { data: userDebts } = await supabase
          .from('debts')
          .select('*')
          .or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`);

        const debtIds = (userDebts || []).map((d: any) => d.id);
        let userPayments: any[] = [];
        if (debtIds.length > 0) {
          const { data: pData } = await supabase
            .from('payments')
            .select('*')
            .in('debt_id', debtIds);
          userPayments = pData || [];
        }

        let activeDebtCount = 0;
        let pendingDebtCount = 0;
        let totalOutstanding = 0;

        for (const d of (userDebts || [])) {
          if (d.status === 'pending') {
            pendingDebtCount++;
          } else if (d.status === 'active' || d.status === 'disputed') {
            const paymentsForDebt = userPayments.filter((p: any) => p.debt_id === d.id);
            const calc = calculateDebtBalance(d, paymentsForDebt);
            if (calc.currentBalance > 0.01) {
              activeDebtCount++;
              totalOutstanding += calc.currentBalance;
            }
          }
        }

        setDebtObligations({
          activeCount: activeDebtCount,
          pendingCount: pendingDebtCount,
          totalBalance: round2(totalOutstanding),
          canDelete: activeDebtCount === 0 && pendingDebtCount === 0 && totalOutstanding <= 0.01,
        });

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
      const user = await getCurrentUserFast(supabase);
      if (!user) throw new Error('Not authenticated');

      const cleanPhone = phone.trim();
      const phoneDigits = cleanPhone.replace(/[^\d]/g, '');
      if (!cleanPhone || phoneDigits.length < 7) {
        throw new Error('Primary phone number is compulsory. Please enter your phone number.');
      }

      // Check phone uniqueness before saving
      const phoneConflict = await checkIdentifierConflict(undefined, cleanPhone, user.id);
      if (phoneConflict.hasConflict) {
        throw new Error(phoneConflict.message || 'This phone number is already registered to another account.');
      }

      if (upiId.trim() && !isValidUPIId(upiId.trim())) {
        throw new Error('Please enter a valid UPI ID (e.g. username@okhdfcbank, name@upi, 9876543210@paytm)');
      }

      // Update profile
      const profilePayload: any = {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        upi_id: upiId.trim() || null,
        secondary_emails: secondaryEmails,
        avatar_url: avatarUrl,
        recent_custom_avatars: recentCustomAvatars,
      };

      const { error: profileError } = await supabase
        .from('profiles')
        .update(profilePayload)
        .eq('id', user.id);

      if (profileError) {
        if (profileError.message?.includes('recent_custom_avatars') || profileError.message?.includes('upi_id')) {
          delete profilePayload.recent_custom_avatars;
          delete profilePayload.upi_id;
          await supabase.from('profiles').update(profilePayload).eq('id', user.id);
        } else {
          throw profileError;
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('debtsync:user_updated', {
            detail: {
              avatarUrl,
              fullName: fullName.trim(),
              recentCustomAvatars,
            },
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
        theme_preference: getStoredTheme(),
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

  const handleToggleViewMode = (mode: 'admin' | 'user') => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('debtsync_view_mode', mode);
      window.dispatchEvent(new CustomEvent('debtsync:view_mode_changed', { detail: { mode } }));
    }
    setMessage(`Switched to ${mode === 'admin' ? 'Administrator' : 'Normal User'} display view.`);
  };

  const handlePromoteToAdmin = async () => {
    setPromotingAdmin(true);
    setMessage('');
    setError('');
    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) return;
      const { error: rpcErr } = await supabase.rpc('promote_user_to_admin');
      if (rpcErr) {
        await supabase.from('profiles').update({ is_admin: true }).eq('id', user.id);
      }
      setIsAdmin(true);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('debtsync:user_updated', { detail: { isAdmin: true } }));
      }
      setMessage('Your account has been granted Administrator privileges.');
    } catch (err: any) {
      setError(err.message || 'Failed to promote account to admin.');
    } finally {
      setPromotingAdmin(false);
    }
  };

  const handleExportCSV = async () => {
    if (!userId) return;
    setExportingCsv(true);
    setMessage('');
    setError('');
    try {
      const res = await exportUserDataToCSV(supabase, userId);
      if (!res.success) {
        setError(res.error || 'Failed to export CSV archive');
      } else {
        setMessage('Financial archive CSV downloaded successfully!');
      }
    } catch (err: any) {
      setError(err.message || 'Export error');
    } finally {
      setExportingCsv(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmationText.trim() !== 'DELETE MY ACCOUNT') {
      setError('Please type "DELETE MY ACCOUNT" exactly to confirm.');
      return;
    }

    setDeletingAccount(true);
    setError('');
    setMessage('');

    try {
      // 1. Try secure RPC delete_user_account
      let rpcSucceeded = false;
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('delete_user_account');
        if (!rpcErr && rpcRes && rpcRes.success) {
          rpcSucceeded = true;
        } else if (rpcRes && rpcRes.error) {
          throw new Error(rpcRes.error);
        }
      } catch (rpcEx: any) {
        if (rpcEx.message?.includes('Account deletion blocked')) {
          throw rpcEx;
        }
      }

      // 2. Client fallback cleanup if RPC not deployed or partial
      if (!rpcSucceeded && userId) {
        await supabase.from('user_settings').delete().eq('user_id', userId);
        await supabase.from('contacts').delete().or(`owner_id.eq.${userId},contact_id.eq.${userId}`);
        await supabase.from('profiles').delete().eq('id', userId);
      }

      // 3. Clear all client storage & session
      await supabase.auth.signOut();
      if (typeof window !== 'undefined') {
        localStorage.clear();
        sessionStorage.clear();
        document.cookie = 'debtsync_theme=; path=/; max-age=0';
        document.cookie = 'sb-access-token=; path=/; max-age=0';
        document.cookie = 'sb-refresh-token=; path=/; max-age=0';
      }

      // 4. Redirect to login with deleted flag
      window.location.href = '/login?deleted=true';
    } catch (err: any) {
      setError(err.message || 'Failed to delete account');
      setDeletingAccount(false);
    }
  };

  return (
    <div className="page-enter max-w-2xl mx-auto space-y-6 md:space-y-8">
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
                    {!isPresetAvatar(avatarUrl) && (
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
                    )}

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

              {/* Recent Custom Photos (Strictly up to 2, older auto-purged from server) */}
              {recentCustomAvatars.length > 0 && (
                <div className="pt-0.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-[11px] text-[var(--outline)] flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[13px]">history</span>
                      Recent custom photos ({recentCustomAvatars.length}/2):
                    </span>
                    <span className="font-mono text-[10px] text-[var(--outline)]/70">
                      Older photos auto-purged from server
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {recentCustomAvatars.map((url, idx) => (
                      <div key={url} className="relative group/custom shrink-0">
                        <button
                          type="button"
                          onClick={() => setAvatarUrl(url)}
                          className={`relative w-8 h-8 rounded-xl overflow-hidden border-2 transition-transform hover:scale-105 shrink-0 cursor-pointer shadow-2xs ${
                            avatarUrl === url
                              ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/30 scale-105'
                              : 'border-transparent opacity-80 hover:opacity-100'
                          }`}
                          title={`Custom Photo ${idx + 1} (Click to apply)`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`Custom ${idx + 1}`} className="w-full h-full object-cover pointer-events-none" />
                          {avatarUrl === url && (
                            <div className="absolute inset-0 bg-[var(--primary)]/25 flex items-center justify-center">
                              <span className="material-symbols-outlined text-[14px] text-white drop-shadow font-bold">check</span>
                            </div>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (userId) {
                              const updated = await removeCustomAvatar(supabase, userId, url, recentCustomAvatars);
                              setRecentCustomAvatars(updated);
                              if (avatarUrl === url) {
                                setAvatarUrl(updated[0] || null);
                              }
                            }
                          }}
                          className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-600 text-white flex items-center justify-center opacity-0 group-hover/custom:opacity-100 transition-opacity cursor-pointer shadow-xs hover:scale-110"
                          title="Delete this custom photo from server"
                        >
                          <span className="material-symbols-outlined text-[10px]">close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                        onClick={() => setAvatarUrl(preset.url)}
                        className={`relative w-8 h-8 rounded-xl overflow-hidden border-2 transition-transform hover:scale-105 shrink-0 cursor-pointer ${
                          avatarUrl === preset.url
                            ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/30 scale-105'
                            : 'border-transparent opacity-80 hover:opacity-100'
                        }`}
                        title={preset.label}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={preset.url} alt={preset.label} className="w-full h-full object-cover pointer-events-none" />
                        {avatarUrl === preset.url && (
                          <div className="absolute inset-0 bg-[var(--primary)]/25 flex items-center justify-center">
                            <span className="material-symbols-outlined text-[14px] text-white drop-shadow font-bold">check</span>
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
                          onClick={() => setAvatarUrl(preset.url)}
                          className={`relative w-8 h-8 rounded-xl overflow-hidden border-2 transition-transform hover:scale-105 shrink-0 cursor-pointer ${
                            avatarUrl === preset.url
                              ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/30 scale-105'
                              : 'border-transparent opacity-80 hover:opacity-100'
                          }`}
                          title={preset.label}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={preset.url} alt={preset.label} className="w-full h-full object-cover pointer-events-none" />
                          {avatarUrl === preset.url && (
                            <div className="absolute inset-0 bg-[var(--primary)]/25 flex items-center justify-center">
                              <span className="material-symbols-outlined text-[14px] text-white drop-shadow font-bold">check</span>
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
            <label className="font-mono text-xs text-[var(--on-surface-variant)] block mb-1 font-semibold">
              Phone Number <span className="normal-case text-[var(--primary)] text-[11px] font-semibold">(compulsory primary contact)</span>
            </label>
            <PhoneInput
              value={phone}
              onChange={setPhone}
              defaultCountryCode={defaultCountryCode}
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-mono text-xs text-[var(--on-surface-variant)] font-semibold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">qr_code_2</span>
                <span>UPI ID / VPA</span>
                <span className="normal-case text-[var(--outline)] text-[11px] font-normal">(for receiving direct repayments &amp; QR)</span>
              </label>
            </div>
            <input
              type="text"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="e.g. yourname@okhdfcbank, mobile@upi"
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm font-mono outline-none focus:border-[var(--primary)]"
            />
            <p className="text-[11px] font-mono text-[var(--on-surface-variant)] mt-1">
              When saved, borrowers can click a single button or scan a generated QR code to pay you directly via GPay, PhonePe, Paytm, etc.
            </p>
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

        {/* Administrator Privileges & View Controls */}
        <div className="pt-6 border-t border-[var(--outline-variant)]/20 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">admin_panel_settings</span>
              <span>Administrator Privileges &amp; View Controls</span>
            </h3>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                isAdmin
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-[var(--surface-container-high)] text-[var(--outline)]'
              }`}
            >
              {isAdmin ? 'ADMIN ACCOUNT' : 'STANDARD USER'}
            </span>
          </div>

          <p className="text-xs text-[var(--on-surface-variant)]">
            Control platform monitoring, inspect global ledgers, and toggle between Administrator and Normal User viewing modes.
          </p>

          <div className="p-4 rounded-2xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="font-mono text-xs font-bold text-[var(--on-surface)] block">
                  Active Display Mode
                </span>
                <span className="text-[11px] font-mono text-[var(--on-surface-variant)]">
                  Switching to Normal User View simulates the standard client experience.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleViewMode('user')}
                  className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer ${
                    viewMode === 'user'
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-sm'
                      : 'bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                  }`}
                >
                  👤 Normal View
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleViewMode('admin')}
                  className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer ${
                    viewMode === 'admin'
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-sm'
                      : 'bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                  }`}
                >
                  ⚡ Admin View
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--outline-variant)]/15 flex flex-wrap items-center justify-between gap-2">
              <Link
                href="/admin"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:brightness-110 shadow-xs"
              >
                <span className="material-symbols-outlined text-[15px]">dashboard</span>
                <span>Open Admin Observatory</span>
              </Link>

              {!isAdmin && (
                <button
                  type="button"
                  disabled={promotingAdmin}
                  onClick={handlePromoteToAdmin}
                  className="px-3 py-1.5 rounded-xl border border-[var(--outline-variant)]/40 hover:bg-[var(--surface-container-high)] text-[var(--primary)] font-mono text-xs font-bold transition-colors cursor-pointer"
                >
                  {promotingAdmin ? 'Promoting...' : 'Make My Account an Admin'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Advanced App & System Options (Discreet & Collapsible) */}
        <div className="pt-6 border-t border-[var(--outline-variant)]/20">
          <button
            type="button"
            onClick={() => setShowAdvancedApp(!showAdvancedApp)}
            className="w-full flex items-center justify-between py-2 text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-[var(--outline)] group-hover:text-[var(--primary)] transition-colors">
                install_mobile
              </span>
              <span className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)] group-hover:text-[var(--on-surface)] transition-colors">
                App Installation &amp; System Settings
              </span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--outline)]">
              <span>{showAdvancedApp ? 'Hide' : 'Show options'}</span>
              <span className="material-symbols-outlined text-[16px] transition-transform duration-150">
                {showAdvancedApp ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
              </span>
            </div>
          </button>

          {showAdvancedApp && (
            <div className="mt-3 p-4 rounded-2xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/30 space-y-4 animate-in fade-in duration-200">
              {/* PWA App Status & Action */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-mono text-xs font-bold text-[var(--on-surface)] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">devices</span>
                    Installable Progressive Web App (PWA)
                  </h4>
                  <p className="text-xs text-[var(--on-surface-variant)] mt-0.5">
                    {isStandalone
                      ? 'DebtSync is currently running in standalone installed app mode.'
                      : 'Install DebtSync on your phone or desktop for instant home-screen launch and offline support.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                      className="px-3.5 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-xs inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">download</span>
                      Install App
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        triggerPWAInstallPrompt();
                        setMessage('PWA install prompt banner re-activated!');
                      }}
                      className="px-3 py-1.5 rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)] font-mono text-xs font-bold hover:bg-[var(--primary)]/20 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                      title="Reset 3-dismissal snooze and show install banner"
                    >
                      <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                      Re-enable Install Banner
                    </button>
                  )}
                </div>
              </div>

              {/* Install instructions for Safari & browsers without auto-prompt */}
              {!isStandalone && !deferredInstallPrompt && (
                <div className="p-3 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/20 text-xs text-[var(--on-surface-variant)] space-y-1.5 font-mono">
                  <p className="font-bold text-[var(--on-surface)] flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">info</span>
                    Browser Install Instructions:
                  </p>
                  <p>&bull; iOS Safari: Tap the Share button (<strong className="text-[var(--on-surface)]">[&uarr;]</strong>) &rarr; select <strong className="text-[var(--on-surface)]">&quot;Add to Home Screen&quot;</strong>.</p>
                  <p>&bull; Chrome / Edge / Android: Tap the browser menu (&vellip;) &rarr; select <strong className="text-[var(--on-surface)]">&quot;Install DebtSync&quot;</strong> or <strong className="text-[var(--on-surface)]">&quot;Add to Home Screen&quot;</strong>.</p>
                </div>
              )}

              {/* Persistent Session & Cookies Info */}
              <div className="pt-3 border-t border-[var(--outline-variant)]/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-mono text-xs font-bold text-[var(--on-surface)] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-emerald-500">cookie</span>
                    Fast Persistent Sign-In Cookies
                  </h4>
                  <p className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">
                    Authentication cookies are configured with 1-year persistence and local cache so page reloads are instantaneous without waiting for server roundtrips until you sign out.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 self-start sm:self-center">
                  Active &bull; 1-Year Expiry
                </span>
              </div>
            </div>
          )}
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

      {/* Financial Data Export */}
      <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--outline-variant)]/30 shadow-sm space-y-4">
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider font-semibold text-[var(--on-surface-variant)] flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">download</span>
            Financial Data Export
          </h3>
          <p className="text-xs text-[var(--on-surface-variant)] mt-1">
            Download your complete financial archive including all debt agreements, repayment logs, interest calculations, and contacts as an RFC-4180 CSV spreadsheet.
          </p>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={exportingCsv || !userId}
            className="px-4 py-2.5 rounded-xl bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] border border-[var(--outline-variant)]/40 font-mono text-xs font-bold inline-flex items-center gap-2 transition-all cursor-pointer shadow-xs disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">
              {exportingCsv ? 'hourglass_top' : 'file_download'}
            </span>
            <span>{exportingCsv ? 'Generating Archive...' : 'Export Complete Ledger to CSV'}</span>
          </button>
        </div>
      </div>

      {/* Danger Zone: Restricted Account Deletion */}
      <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 md:p-8 border border-[var(--error)]/30 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-[var(--error)]">
            warning
          </span>
          <h3 className="font-mono text-xs uppercase tracking-wider font-bold text-[var(--error)]">
            Danger Zone &bull; Account Deletion
          </h3>
        </div>

        <p className="text-xs text-[var(--on-surface-variant)] leading-relaxed">
          Permanent account deletion is strictly restricted to protect financial accountability. An account may only be deleted when <strong>all debt obligations are completely settled or cleared to a zero balance</strong>.
        </p>

        {!debtObligations.canDelete ? (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 space-y-2">
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase">
              <span className="material-symbols-outlined text-[18px]">lock</span>
              <span>Account Deletion Restricted</span>
            </div>
            <p className="text-xs leading-relaxed">
              You currently have outstanding financial obligations that must be resolved first:
            </p>
            <ul className="text-xs list-disc list-inside space-y-1 font-mono">
              {debtObligations.activeCount > 0 && (
                <li>
                  {debtObligations.activeCount} active debt obligation(s) with an unsettled balance of{' '}
                  <span className="font-bold">{formatCurrency(debtObligations.totalBalance, currency)}</span>.
                </li>
              )}
              {debtObligations.pendingCount > 0 && (
                <li>
                  {debtObligations.pendingCount} pending agreement request(s) awaiting confirmation or decline.
                </li>
              )}
            </ul>
            <p className="text-[11px] text-amber-700 dark:text-amber-400 pt-1">
              Please settle all debts or decline pending agreements to unlock account deletion.
            </p>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400 space-y-2">
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              <span>All Obligations Settled</span>
            </div>
            <p className="text-xs">
              Your debt balance is completely zero and all agreements are settled. You are eligible to delete your account.
            </p>
          </div>
        )}

        <div className="pt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!debtObligations.canDelete || loading}
            onClick={() => {
              setDeleteConfirmationText('');
              setIsDeleteModalOpen(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-[var(--error)]/10 text-[var(--error)] hover:bg-[var(--error)] hover:text-white border border-[var(--error)]/40 font-mono text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-2 shadow-xs"
          >
            <span className="material-symbols-outlined text-[18px]">delete_forever</span>
            <span>Delete Account</span>
          </button>
          {!debtObligations.canDelete && (
            <span className="text-[11px] font-mono text-[var(--outline)]">
              Locked until all active &amp; pending debts are resolved
            </span>
          )}
        </div>
      </div>

      {/* Account Deletion Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          if (!deletingAccount) setIsDeleteModalOpen(false);
        }}
        title="Delete DebtSync Account"
        subtitle="Irreversible action: This will permanently wipe your account"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-[var(--error)] space-y-1.5">
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase">
              <span className="material-symbols-outlined text-[18px]">warning</span>
              <span>Irreversible Data Deletion</span>
            </div>
            <p className="text-xs leading-relaxed">
              This action cannot be undone. All your profile data, contact directory, settings, and settlement records will be permanently erased.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-[var(--surface-container)] border border-[var(--outline-variant)]/20 space-y-2">
            <p className="text-xs font-mono font-semibold text-[var(--on-surface)]">
              Before you delete:
            </p>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={exportingCsv}
              className="w-full py-2 px-3 rounded-lg bg-[var(--surface-container-high)] hover:bg-[var(--surface-container-highest)] text-xs font-mono font-bold text-[var(--primary)] border border-[var(--primary)]/30 flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              <span>{exportingCsv ? 'Downloading...' : 'Export Financial Ledger to CSV First'}</span>
            </button>
          </div>

          <div className="space-y-1.5 pt-2">
            <label className="font-mono text-xs text-[var(--on-surface-variant)] block">
              Type <strong className="text-[var(--error)] select-all">DELETE MY ACCOUNT</strong> to confirm:
            </label>
            <input
              type="text"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              placeholder="DELETE MY ACCOUNT"
              disabled={deletingAccount}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--error)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm font-mono outline-none focus:border-[var(--error)] focus:ring-2 focus:ring-[var(--error)]/20"
            />
          </div>

          <div className="pt-3 border-t border-[var(--outline-variant)]/20 flex gap-3">
            <button
              type="button"
              disabled={deletingAccount}
              onClick={() => setIsDeleteModalOpen(false)}
              className="flex-1 py-2.5 px-4 rounded-xl border border-[var(--outline-variant)]/40 font-mono text-xs font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container)] cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteConfirmationText.trim() !== 'DELETE MY ACCOUNT' || deletingAccount}
              onClick={handleDeleteAccount}
              className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--error)] text-white font-mono text-xs font-bold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm"
            >
              {deletingAccount ? 'Deleting...' : 'Permanently Delete'}
            </button>
          </div>
        </div>
      </Modal>

      {userId && (
        <AvatarCropModal
          isOpen={isCropModalOpen}
          onClose={() => {
            setIsCropModalOpen(false);
            setCropImageSrc(null);
          }}
          imageSrc={cropImageSrc}
          userId={userId}
          currentRecent={recentCustomAvatars}
          onAvatarSaved={(newUrl, updatedRecent) => {
            setAvatarUrl(newUrl);
            if (updatedRecent) {
              setRecentCustomAvatars(updatedRecent);
            }
            setMessage('Profile picture cropped, saved, and optimized under 5MB!');
          }}
        />
      )}
    </div>
  );
}
